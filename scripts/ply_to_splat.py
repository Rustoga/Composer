#!/usr/bin/env python3
"""Convert a binary_little_endian PLY point cloud to the standard 32-byte
per-splat .splat format:

  Bytes 0-11:  float32[3] position (x, y, z)
  Bytes 12-23: float32[3] scale    (sx, sy, sz)
  Bytes 24-27: uint8[4]   RGBA color (0-255)
  Bytes 28-31: uint8[4]   rotation quaternion (mapped [-1, 1] -> [0, 255])

Input PLY is a dense RGB point cloud (x,y,z floats + red,green,blue uchar).
Defaults are synthesised: uniform scale 0.1, identity quaternion [255,128,128,128],
full opacity 255.

Processing:
  * Statistical outlier filtering (2nd-98th percentile bounding box, strip
    points > 3.5x IQR from cabin core) to remove stray sky/horizon scan rays.
  * Seeded Fisher-Yates shuffle so progressive HLOD samples the entire cabin
    uniformly instead of drawing isolated scan-lines.
  * Z-up -> Y-up axis swap (Scaniverse/LiDAR exports are typically Z-up;
    Three.js uses Y-up).
"""
import struct
import sys
import random
from pathlib import Path

TYPE_SIZES = {
    'float': 4, 'double': 8, 'int': 4, 'uint': 4,
    'short': 2, 'ushort': 2, 'int8': 1, 'uint8': 1, 'char': 1, 'uchar': 1,
}

DEFAULT_SCALE = 0.1
DEFAULT_ROTATION_UINT8 = (255, 128, 128, 128)  # identity quaternion [1,0,0,0]
SHUFFLE_SEED = 42


def read_ply(path):
    with open(path, 'rb') as f:
        lines = []
        while True:
            line = f.readline()
            if not line:
                raise ValueError("Unexpected EOF inside PLY header")
            lines.append(line.decode('ascii', errors='replace').strip())
            if lines[-1] == 'end_header':
                break

        if lines[0] != 'ply':
            raise ValueError(f"Not a PLY file: first line '{lines[0]}'")

        fmt = None
        elements = []
        cur = None
        for line in lines[1:]:
            parts = line.split()
            if not parts:
                continue
            if parts[0] == 'format':
                fmt = parts[1]
            elif parts[0] == 'element':
                cur = {'name': parts[1], 'count': int(parts[2]), 'props': []}
                elements.append(cur)
            elif parts[0] == 'property' and cur is not None:
                if parts[1] == 'list':
                    cur['props'].append({
                        'list': True, 'count_type': parts[2],
                        'item_type': parts[3], 'name': parts[4],
                    })
                else:
                    cur['props'].append({
                        'list': False, 'type': parts[1], 'name': parts[2],
                    })

        if fmt != 'binary_little_endian':
            raise ValueError(
                f"Only binary_little_endian PLY supported, got '{fmt}'"
            )

        vertex = next((e for e in elements if e['name'] == 'vertex'), None)
        if vertex is None:
            raise ValueError("PLY has no 'vertex' element")

        count = vertex['count']

        prop_map = {}
        offset = 0
        for pr in vertex['props']:
            if pr['list']:
                continue
            size = TYPE_SIZES.get(pr['type'], 1)
            prop_map[pr['name']] = (offset, pr['type'], size)
            offset += size
        stride = offset

        raw = f.read(count * stride)
        if len(raw) < count * stride:
            raise ValueError(
                f"Truncated PLY body: expected {count * stride} bytes, "
                f"got {len(raw)}"
            )

    return raw, count, stride, prop_map


def compute_percentile(sorted_arr, p):
    n = len(sorted_arr)
    idx = int((p / 100.0) * (n - 1))
    return sorted_arr[idx]


def filter_outliers(raw, count, stride, prop_map):
    """Remove points beyond 3.5x IQR from the 2nd-98th percentile bounding box."""
    xs = [0.0] * count
    ys = [0.0] * count
    zs = [0.0] * count

    for i in range(count):
        base = i * stride
        xs[i] = struct.unpack_from('<f', raw, base + prop_map['x'][0])[0]
        ys[i] = struct.unpack_from('<f', raw, base + prop_map['y'][0])[0]
        zs[i] = struct.unpack_from('<f', raw, base + prop_map['z'][0])[0]

    xs.sort(); ys.sort(); zs.sort()

    def bounds(arr):
        p2 = compute_percentile(arr, 2)
        p98 = compute_percentile(arr, 98)
        iqr = p98 - p2
        lo = p2 - 3.5 * iqr
        hi = p98 + 3.5 * iqr
        return lo, hi

    x_lo, x_hi = bounds(xs)
    y_lo, y_hi = bounds(ys)
    z_lo, z_hi = bounds(zs)

    keep = []
    for i in range(count):
        base = i * stride
        x = struct.unpack_from('<f', raw, base + prop_map['x'][0])[0]
        y = struct.unpack_from('<f', raw, base + prop_map['y'][0])[0]
        z = struct.unpack_from('<f', raw, base + prop_map['z'][0])[0]
        if x_lo <= x <= x_hi and y_lo <= y <= y_hi and z_lo <= z <= z_hi:
            keep.append(i)

    kept_raw = bytearray(len(keep) * stride)
    for new_i, old_i in enumerate(keep):
        old_base = old_i * stride
        new_base = new_i * stride
        kept_raw[new_base:new_base + stride] = raw[old_base:old_base + stride]

    removed = count - len(keep)
    print(f"Outlier filtering: {count} -> {len(keep)} points (removed {removed})")
    return bytes(kept_raw), len(keep)


def fisher_yates_shuffle(arr, seed):
    """In-place seeded Fisher-Yates shuffle."""
    rng = random.Random(seed)
    n = len(arr)
    for i in range(n - 1, 0, -1):
        j = rng.randint(0, i)
        arr[i], arr[j] = arr[j], arr[i]


def convert(path):
    raw, count, stride, prop_map = read_ply(path)

    # --- field presence ---
    has_xyz = all(k in prop_map for k in ('x', 'y', 'z'))
    has_rgb = all(k in prop_map for k in ('red', 'green', 'blue'))
    has_fdc = all(k in prop_map for k in ('f_dc_0', 'f_dc_1', 'f_dc_2'))
    has_scale = all(k in prop_map for k in ('scale_0', 'scale_1', 'scale_2'))
    rot_keys_a = ('rot_0', 'rot_1', 'rot_2', 'rot_3')
    rot_keys_b = ('quat_w', 'quat_x', 'quat_y', 'quat_z')
    has_rot = all(k in prop_map for k in rot_keys_a) or all(k in prop_map for k in rot_keys_b)
    has_opacity = 'opacity' in prop_map

    if not has_xyz:
        raise ValueError("PLY vertex has no x/y/z position properties")

    # --- outlier filtering ---
    raw, count = filter_outliers(raw, count, stride, prop_map)

    # --- convert ---
    splats = []
    for i in range(count):
        base = i * stride

        # position (Z-up -> Y-up swap: y_new = z, z_new = y)
        x = struct.unpack_from('<f', raw, base + prop_map['x'][0])[0]
        y_raw = struct.unpack_from('<f', raw, base + prop_map['y'][0])[0]
        z_raw = struct.unpack_from('<f', raw, base + prop_map['z'][0])[0]
        y = z_raw   # Z becomes Y (up)
        z = y_raw   # Y becomes Z (depth)

        # color (RGBA uint8)
        if has_rgb:
            r = raw[base + prop_map['red'][0]]
            g = raw[base + prop_map['green'][0]]
            b = raw[base + prop_map['blue'][0]]
            a = 255
        elif has_fdc:
            C0 = 0.28209479177387814
            r = int(max(0, min(255, (0.5 + C0 * struct.unpack_from('<f', raw, base + prop_map['f_dc_0'][0])[0]) * 255)))
            g = int(max(0, min(255, (0.5 + C0 * struct.unpack_from('<f', raw, base + prop_map['f_dc_1'][0])[0]) * 255)))
            b = int(max(0, min(255, (0.5 + C0 * struct.unpack_from('<f', raw, base + prop_map['f_dc_2'][0])[0]) * 255)))
            a = 255
        else:
            r = g = b = 128
            a = 255

        # scale
        if has_scale:
            sx = struct.unpack_from('<f', raw, base + prop_map['scale_0'][0])[0]
            sy = struct.unpack_from('<f', raw, base + prop_map['scale_1'][0])[0]
            sz = struct.unpack_from('<f', raw, base + prop_map['scale_2'][0])[0]
        else:
            sx = sy = sz = DEFAULT_SCALE

        # rotation quaternion (mapped [-1,1] -> [0,255])
        if has_rot:
            rk = rot_keys_a if all(k in prop_map for k in rot_keys_a) else rot_keys_b
            q0 = struct.unpack_from('<f', raw, base + prop_map[rk[0]][0])[0]
            q1 = struct.unpack_from('<f', raw, base + prop_map[rk[1]][0])[0]
            q2 = struct.unpack_from('<f', raw, base + prop_map[rk[2]][0])[0]
            q3 = struct.unpack_from('<f', raw, base + prop_map[rk[3]][0])[0]
            rot = tuple(
                int(max(0, min(255, (q + 1.0) * 127.5))) for q in (q0, q1, q2, q3)
            )
        else:
            rot = DEFAULT_ROTATION_UINT8

        # opacity
        if has_opacity:
            op = struct.unpack_from('<f', raw, base + prop_map['opacity'][0])[0]
            import math
            a = int(max(0, min(255, (1.0 / (1.0 + math.exp(-op))) * 255)))

        mean_scale = (sx + sy + sz) / 3.0
        splats.append({
            'pos': (x, y, z),
            'scale': (sx, sy, sz),
            'color': (r, g, b, a),
            'rot': rot,
            'mean_scale': mean_scale,
        })

    # --- seeded shuffle so progressive HLOD samples the whole cabin uniformly ---
    fisher_yates_shuffle(splats, SHUFFLE_SEED)

    # --- write .splat ---
    out = bytearray(count * 32)
    for i, s in enumerate(splats):
        b = i * 32
        struct.pack_into('<fff', out, b, *s['pos'])
        struct.pack_into('<fff', out, b + 12, *s['scale'])
        out[b + 24] = s['color'][0]
        out[b + 25] = s['color'][1]
        out[b + 26] = s['color'][2]
        out[b + 27] = s['color'][3]
        out[b + 28] = s['rot'][0]
        out[b + 29] = s['rot'][1]
        out[b + 30] = s['rot'][2]
        out[b + 31] = s['rot'][3]

    out_path = path.with_suffix('.splat')
    out_path.write_bytes(bytes(out))

    orig_mb = path.stat().st_size / (1024 * 1024)
    new_mb = out_path.stat().st_size / (1024 * 1024)
    savings = (1 - new_mb / orig_mb) * 100 if orig_mb > 0 else 0

    print(f"Converted {path} -> {out_path}")
    print(f"  Splats:   {count:,}")
    print(f"  Original: {orig_mb:.2f} MB")
    print(f"  .splat:   {new_mb:.2f} MB")
    print(f"  Savings:  {savings:.1f}%")


if __name__ == '__main__':
    src = Path("mokki/splats.ply")
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    if not src.exists():
        print(f"Error: {src} not found", file=sys.stderr)
        sys.exit(1)
    convert(src)
