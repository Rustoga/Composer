#!/usr/bin/env python3
"""Convert a binary_little_endian PLY Gaussian splat point cloud to the
standard 32-byte-per-splat .splat format:

  Bytes 0-11:  float32[3] position (x, y, z)
  Bytes 12-23: float32[3] scale    (sx, sy, sz)
  Bytes 24-27: uint8[4]   RGBA color (0-255)
  Bytes 28-31: uint8[4]   rotation quaternion, mapped [-1,1] -> [0,255]

If the PLY lacks scale/rotation/opacity, sensible defaults are synthesised
(uniform scale 0.1, identity quaternion [255,128,128,128], full opacity 255)
so the output renders identically to the current PLY shader.

Splats are sorted by mean scale descending (when scale data is present) so
progressive streaming renders large structures first.
"""
import struct
import sys
from pathlib import Path

TYPE_SIZES = {
    'float': 4, 'double': 8, 'int': 4, 'uint': 4,
    'short': 2, 'ushort': 2, 'int8': 1, 'uint8': 1, 'char': 1, 'uchar': 1,
}

DEFAULT_SCALE = 0.1
DEFAULT_ROTATION_UINT8 = (255, 128, 128, 128)  # identity quaternion [1,0,0,0]


def read_ply(path):
    with open(path, 'rb') as f:
        # --- header ---
        lines = []
        while True:
            line = f.readline()
            if not line:
                raise ValueError("Unexpected EOF inside PLY header")
            lines.append(line.decode('ascii').strip())
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

        # --- property map: name -> (byte_offset, type, size) ---
        prop_map = {}
        offset = 0
        for pr in vertex['props']:
            if pr['list']:
                continue
            size = TYPE_SIZES.get(pr['type'], 1)
            prop_map[pr['name']] = (offset, pr['type'], size)
            offset += size
        stride = offset

        # --- raw vertex block ---
        raw = f.read(count * stride)
        if len(raw) < count * stride:
            raise ValueError(
                f"Truncated PLY body: expected {count * stride} bytes, "
                f"got {len(raw)}"
            )

    return raw, count, stride, prop_map


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

    # --- convert ---
    splats = []
    for i in range(count):
        base = i * stride

        # position
        x = struct.unpack_from('<f', raw, base + prop_map['x'][0])[0]
        y = struct.unpack_from('<f', raw, base + prop_map['y'][0])[0]
        z = struct.unpack_from('<f', raw, base + prop_map['z'][0])[0]

        # color (RGBA uint8)
        if has_rgb:
            r = raw[base + prop_map['red'][0]]
            g = raw[base + prop_map['green'][0]]
            b = raw[base + prop_map['blue'][0]]
            a = 255
        elif has_fdc:
            # approximate RGB from spherical-harmonic DC coefficients
            r = int(max(0, min(255,
                (0.5 + struct.unpack_from('<f', raw, base + prop_map['f_dc_0'][0])[0]) * 255)))
            g = int(max(0, min(255,
                (0.5 + struct.unpack_from('<f', raw, base + prop_map['f_dc_1'][0])[0]) * 255)))
            b = int(max(0, min(255,
                (0.5 + struct.unpack_from('<f', raw, base + prop_map['f_dc_2'][0])[0]) * 255)))
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

        # opacity (stored in alpha channel of color)
        if has_opacity:
            op = struct.unpack_from('<f', raw, base + prop_map['opacity'][0])[0]
            a = int(max(0, min(255, op * 255)))

        mean_scale = (sx + sy + sz) / 3.0
        splats.append({
            'pos': (x, y, z),
            'scale': (sx, sy, sz),
            'color': (r, g, b, a),
            'rot': rot,
            'mean_scale': mean_scale,
        })

    # --- sort by size descending so large structures stream first ---
    if has_scale:
        splats.sort(key=lambda s: s['mean_scale'], reverse=True)

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
