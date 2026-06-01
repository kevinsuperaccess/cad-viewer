# -*- coding: utf-8 -*-
# export_revit.py - pyRevit script
# Run this inside Revit via pyRevit (push panel button or run from pyRevit console).
# Revit must be open with an active document.
#
# Output: writes model.gltf, model.bin, schedules.json to OUTPUT_DIR.
# Set OUTPUT_DIR below to match where your cad-viewer app expects the files.

import os
import sys
import json
import struct
import math

# -- Configuration -------------------------------------------------------------
# Point this at the revit-exports folder inside your cad-viewer project.
# Use an absolute path or a path relative to this script.
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          '..', 'revit-exports')

# -- Revit API imports ---------------------------------------------------------
try:
    from Autodesk.Revit.DB import (
        FilteredElementCollector,
        Options,
        ViewDetailLevel,
        GeometryInstance,
        Solid,
        SectionType,
        ViewSchedule,
    )
except ImportError:
    print("ERROR: Autodesk.Revit.DB not available - run this script inside Revit via pyRevit.")
    sys.exit(1)

# Get the active document from the pyRevit / Revit host environment.
# __revit__ is injected by pyRevit; fall back to the revit module if available.
try:
    doc = __revit__.ActiveUIDocument.Document  # noqa: F821  (injected by pyRevit)
except NameError:
    try:
        from pyrevit import revit
        doc = revit.doc
    except Exception:
        print("ERROR: No active Revit document. Open an RVT file in Revit first.")
        sys.exit(1)

if doc is None:
    print("ERROR: No active Revit document. Open an RVT file in Revit first.")
    sys.exit(1)

# -- Output directory ----------------------------------------------------------
try:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
except OSError as e:
    print("ERROR: Cannot create output directory {}: {}".format(OUTPUT_DIR, e))
    sys.exit(1)

GLTF_PATH  = os.path.join(OUTPUT_DIR, 'model.gltf')
BIN_PATH   = os.path.join(OUTPUT_DIR, 'model.bin')
SCHED_PATH = os.path.join(OUTPUT_DIR, 'schedules.json')

FEET_TO_METRES = 0.3048

# -- Geometry helpers ----------------------------------------------------------

opts = Options()
opts.ComputeReferences = False
opts.DetailLevel = ViewDetailLevel.Fine
opts.IncludeNonVisibleObjects = False


def safe_get_geometry(element):
    try:
        return element.get_Geometry(opts)
    except Exception as e:
        print("Skipping element {}: {}".format(element.Id, e))
        return None


def revit_to_gltf(x, y, z):
    """Convert Revit feet (Z-up) to glTF metres (Y-up)."""
    return (x * FEET_TO_METRES,
            z * FEET_TO_METRES,
            -y * FEET_TO_METRES)


def normalise(v):
    length = math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)
    if length < 1e-10:
        return (0.0, 1.0, 0.0)
    return (v[0]/length, v[1]/length, v[2]/length)


def cross(a, b):
    return (a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0])


def sub(a, b):
    return (a[0]-b[0], a[1]-b[1], a[2]-b[2])


def apply_transform(transform, vertex):
    """Apply a Revit Transform to a XYZ vertex."""
    try:
        xf = transform.OfPoint(vertex)
        return (xf.X, xf.Y, xf.Z)
    except Exception:
        return (vertex.X, vertex.Y, vertex.Z)


def get_material_id(element):
    """Return a stable material key for grouping geometry."""
    try:
        mat_ids = element.GetMaterialIds(False)
        if mat_ids and mat_ids.Count > 0:
            return str(list(mat_ids)[0])
    except Exception:
        pass
    try:
        cat = element.Category
        if cat is not None:
            return "cat_{}".format(cat.Id)
    except Exception:
        pass
    return "default"


def walk_geometry(geo_elem, transform, mat_key, out_verts, out_normals, out_indices):
    """
    Recursively walk a GeometryElement.
    Appends (position, normal) tuples to out_verts/out_normals and triangle
    indices to out_indices - all relative to the start of this call's batch.
    """
    if geo_elem is None:
        return

    for geo_obj in geo_elem:
        if isinstance(geo_obj, GeometryInstance):
            child_transform = geo_obj.Transform
            # Compose transforms: apply parent first, then child
            try:
                combined = transform.Multiply(child_transform) if transform else child_transform
            except Exception:
                combined = child_transform
            walk_geometry(geo_obj.GetInstanceGeometry(), combined,
                          mat_key, out_verts, out_normals, out_indices)

        elif isinstance(geo_obj, Solid):
            if geo_obj.Volume < 1e-9:
                continue
            try:
                faces = geo_obj.Faces
            except Exception:
                continue

            for face in faces:
                try:
                    mesh = face.Triangulate()
                except Exception:
                    continue
                if mesh is None or mesh.NumTriangles == 0:
                    continue

                raw_verts = list(mesh.Vertices)
                # Apply transform and convert units/axes
                converted = []
                for v in raw_verts:
                    if transform is not None:
                        tx, ty, tz = apply_transform(transform, v)
                    else:
                        tx, ty, tz = v.X, v.Y, v.Z
                    converted.append(revit_to_gltf(tx, ty, tz))

                for tri_idx in range(mesh.NumTriangles):
                    try:
                        tri = mesh.get_Triangle(tri_idx)
                    except Exception:
                        continue

                    i0 = tri.get_Index(0)
                    i1 = tri.get_Index(1)
                    i2 = tri.get_Index(2)
                    if (i0 >= len(converted) or i1 >= len(converted) or
                            i2 >= len(converted)):
                        continue

                    p0, p1, p2 = converted[i0], converted[i1], converted[i2]

                    # Per-face flat normal (cross product of two edges)
                    edge1 = sub(p1, p0)
                    edge2 = sub(p2, p0)
                    normal = normalise(cross(edge1, edge2))

                    base = len(out_verts)
                    out_verts.extend([p0, p1, p2])
                    out_normals.extend([normal, normal, normal])
                    out_indices.extend([base, base+1, base+2])


# -- Collect geometry grouped by material -------------------------------------

print("Collecting elements...")
collector = FilteredElementCollector(doc).WhereElementIsNotElementType()

# mat_key -> { 'verts': [...], 'normals': [...], 'indices': [...] }
material_map = {}
skipped = 0
processed = 0

for element in collector:
    # Skip elements without a category
    try:
        if element.Category is None:
            continue
    except Exception:
        continue

    geo = safe_get_geometry(element)
    if geo is None:
        skipped += 1
        continue

    mat_key = get_material_id(element)
    if mat_key not in material_map:
        material_map[mat_key] = {'verts': [], 'normals': [], 'indices': []}

    bucket = material_map[mat_key]
    try:
        walk_geometry(geo, None, mat_key,
                      bucket['verts'], bucket['normals'], bucket['indices'])
        processed += 1
    except Exception as e:
        print("Skipping element {} during walk: {}".format(element.Id, e))
        skipped += 1

print("Processed {} elements, skipped {}.".format(processed, skipped))

# -- Build binary buffer -------------------------------------------------------

print("Building glTF binary buffer...")

bin_parts   = []
byte_offset = 0
accessors    = []
buffer_views = []
meshes       = []
nodes        = []

for mat_key, bucket in material_map.items():
    verts   = bucket['verts']
    normals = bucket['normals']
    indices = bucket['indices']

    if len(verts) == 0 or len(indices) == 0:
        continue

    # Positions
    pos_data = struct.pack('<{}f'.format(len(verts) * 3),
                           *[c for v in verts for c in v])
    pos_bv_idx = len(buffer_views)
    buffer_views.append({
        'buffer': 0,
        'byteOffset': byte_offset,
        'byteLength': len(pos_data),
        'target': 34962,
    })
    bin_parts.append(pos_data)
    byte_offset += len(pos_data)

    min_pos = [min(v[i] for v in verts) for i in range(3)]
    max_pos = [max(v[i] for v in verts) for i in range(3)]

    pos_acc_idx = len(accessors)
    accessors.append({
        'bufferView': pos_bv_idx,
        'byteOffset': 0,
        'componentType': 5126,
        'count': len(verts),
        'type': 'VEC3',
        'min': min_pos,
        'max': max_pos,
    })

    # Normals
    nor_data = struct.pack('<{}f'.format(len(normals) * 3),
                           *[c for n in normals for c in n])
    nor_bv_idx = len(buffer_views)
    buffer_views.append({
        'buffer': 0,
        'byteOffset': byte_offset,
        'byteLength': len(nor_data),
        'target': 34962,
    })
    bin_parts.append(nor_data)
    byte_offset += len(nor_data)

    nor_acc_idx = len(accessors)
    accessors.append({
        'bufferView': nor_bv_idx,
        'byteOffset': 0,
        'componentType': 5126,
        'count': len(normals),
        'type': 'VEC3',
    })

    # Indices (Uint32 - models routinely exceed 65535 vertices)
    idx_data = struct.pack('<{}I'.format(len(indices)), *indices)
    idx_bv_idx = len(buffer_views)
    buffer_views.append({
        'buffer': 0,
        'byteOffset': byte_offset,
        'byteLength': len(idx_data),
        'target': 34963,
    })
    bin_parts.append(idx_data)
    byte_offset += len(idx_data)

    idx_acc_idx = len(accessors)
    accessors.append({
        'bufferView': idx_bv_idx,
        'byteOffset': 0,
        'componentType': 5125,
        'count': len(indices),
        'type': 'SCALAR',
    })

    mesh_idx = len(meshes)
    meshes.append({
        'primitives': [{
            'attributes': {
                'POSITION': pos_acc_idx,
                'NORMAL':   nor_acc_idx,
            },
            'indices': idx_acc_idx,
            'mode': 4,
        }],
        'name': mat_key,
    })
    nodes.append({
        'mesh': mesh_idx,
        'extras': {'materialGroup': mat_key},
    })

bin_bytes = b''.join(bin_parts)

# -- Write .bin ----------------------------------------------------------------
try:
    with open(BIN_PATH, 'wb') as f:
        f.write(bin_bytes)
    print("Written: {}  ({:.1f} MB)".format(BIN_PATH, len(bin_bytes) / 1048576.0))
except OSError as e:
    print("ERROR writing {}: {}".format(BIN_PATH, e))
    sys.exit(1)

# -- Write .gltf ---------------------------------------------------------------
gltf = {
    'asset': {'version': '2.0', 'generator': 'cad-viewer/export_revit.py'},
    'scene': 0,
    'scenes': [{'nodes': list(range(len(nodes)))}],
    'nodes':       nodes,
    'meshes':      meshes,
    'accessors':   accessors,
    'bufferViews': buffer_views,
    'buffers': [{
        'uri':        'model.bin',
        'byteLength': len(bin_bytes),
    }],
    'materials': [],
}

try:
    with open(GLTF_PATH, 'w') as f:
        json.dump(gltf, f, indent=2)
    print("Written: {}".format(GLTF_PATH))
except OSError as e:
    print("ERROR writing {}: {}".format(GLTF_PATH, e))
    sys.exit(1)

# -- Schedule extraction -------------------------------------------------------

print("Extracting schedules...")

SKIP_NAMES = set(["<Revision Schedule>", "<Sheet List>", "<Note Block>"])

schedules_out = []

try:
    schedule_views = FilteredElementCollector(doc).OfClass(ViewSchedule)
    for sched in schedule_views:
        try:
            if sched.Name in SKIP_NAMES:
                continue
            if sched.IsTemplate:
                continue

            table = sched.GetTableData()
            body  = table.GetSectionData(SectionType.Body)

            row_count = body.NumberOfRows
            col_count = body.NumberOfColumns

            if row_count == 0:
                schedules_out.append({
                    'schedule': sched.Name,
                    'columns': [],
                    'rows': [],
                })
                continue

            # Row 0 = headers
            headers = []
            for c in range(col_count):
                try:
                    headers.append(body.GetCellText(SectionType.Body, 0, c) or '')
                except Exception:
                    headers.append('')

            rows = []
            for r in range(1, row_count):
                row = []
                for c in range(col_count):
                    try:
                        cell = body.GetCellText(SectionType.Body, r, c) or ''
                        row.append(cell)
                    except Exception:
                        row.append('')
                # Skip completely empty rows
                if any(cell.strip() for cell in row):
                    rows.append(row)

            schedules_out.append({
                'schedule': sched.Name,
                'columns': headers,
                'rows': rows,
            })
            print("  Schedule: '{}' ({} rows)".format(sched.Name, len(rows)))

        except Exception as e:
            print("  Skipping schedule '{}': {}".format(
                getattr(sched, 'Name', '?'), e))

except Exception as e:
    print("WARNING: Could not collect schedules: {}".format(e))

try:
    with open(SCHED_PATH, 'w') as f:
        json.dump(schedules_out, f, indent=2)
    print("Written: {}  ({} schedules)".format(SCHED_PATH, len(schedules_out)))
except OSError as e:
    print("ERROR writing {}: {}".format(SCHED_PATH, e))
    sys.exit(1)

print("\nExport complete.")
print("  Meshes:    {}".format(len(meshes)))
print("  Schedules: {}".format(len(schedules_out)))
print("\nNext step: npm start in cad-viewer/ then open http://localhost:3000")
