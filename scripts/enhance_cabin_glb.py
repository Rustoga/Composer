#!/usr/bin/env python3
#
# enhance_cabin_glb.py
#
# Extracts the embedded baseColor texture from mokki/cabin.glb, applies
# photographic enhancement (unsharp-mask sharpening, subtle warmth +
# contrast micro-grading, shadow lift), and writes the enhanced texture
# back into the GLB while preserving 4-byte chunk padding. Also saves a
# backup as mokki/cabin.orig.glb.
#
# Requires: Pillow (PIL) — falls back to writing the buffer unchanged if
# unavailable (the GLB structure is still rewritten correctly).
#
import struct
import json
import sys
import shutil
import io
from pathlib import Path

try:
    from PIL import Image, ImageEnhance, ImageFilter
    PIL_OK = True
except Exception:
    PIL_OK = False

GLB_PATH = Path("mokki/cabin.glb")
BACKUP_PATH = Path("mokki/cabin.orig.glb")

# Enhancement knobs
SHARPEN_RADIUS = 2
SHARPEN_AMOUNT = 0.35          # unsharp-mask strength
WARMTH = 1.06                  # slight orange/warm lift
CONTRAST = 1.08                # subtle contrast lift
SHADOW_LIFT = 0.06             # lift muddy shadows without clipping highlights


def read_glb_chunks(data):
    """Parse GLB header and return (magic, version, length, chunks)."""
    if data[:4] != b'glTF':
        raise ValueError("Not a GLB file (magic mismatch)")
    version = struct.unpack_from('<I', data, 4)[0]
    length = struct.unpack_from('<I', data, 8)[0]
    chunks = []
    offset = 12
    while offset + 8 <= length:
        chunk_len = struct.unpack_from('<I', data, offset)[0]
        chunk_type = data[offset + 4:offset + 8]
        chunk_data = data[offset + 8:offset + 8 + chunk_len]
        chunks.append({'type': chunk_type, 'data': chunk_data,
                       'len': chunk_len})
        # 4-byte aligned chunk including header
        total = 8 + chunk_len
        pad = (4 - (total % 4)) % 4
        offset += total + pad
    return version, length, chunks


def write_glb_chunks(data, chunks, json_bin_parts):
    """Rebuild GLB bytes from chunks."""
    # Header
    out = bytearray()
    out += b'glTF'
    out += struct.pack('<I', 2)          # version
    # JSON chunk
    json_bytes = json.dumps(json_bin_parts[0], separators=(',', ':')).encode('utf-8')
    json_len = len(json_bytes)
    # Pad JSON to 4-byte alignment
    json_pad = (4 - (json_len % 4)) % 4
    out += struct.pack('<I', json_len + json_pad)
    out += b'JSON'
    out += json_bytes
    out += b' ' * json_pad
    # BIN chunk
    bin_bytes = json_bin_parts[1]
    bin_len = len(bin_bytes)
    bin_pad = (4 - (bin_len % 4)) % 4
    out += struct.pack('<I', bin_len + bin_pad)
    out += b'BIN\x00'           # BIN
    out += bin_bytes
    out += b' ' * bin_pad
    # Length
    total_len = len(out)
    out[8:12] = struct.pack('<I', total_len)
    return bytes(out)


def enhance_image(buf):
    """Run PIL enhancement on a raw image buffer, preserving format."""
    if not PIL_OK:
        return buf, False
    try:
        # Detect input format from magic bytes
        if buf[:4] == b'\xff\xd8\xff\xe0' or buf[:4] == b'\xff\xd8\xff\xdb':
            in_fmt = 'JPEG'
        elif buf[:8] == b'\x89PNG\r\n\x1a\n':
            in_fmt = 'PNG'
        else:
            in_fmt = 'PNG'  # default

        img = Image.open(io.BytesIO(buf))
        img = img.convert('RGBA')
        # --- Unsharp mask sharpening via PIL Sharpness ---
        img = ImageEnhance.Sharpness(img).enhance(1.0 + SHARPEN_AMOUNT)
        # --- Contrast micro-grading ---
        img = ImageEnhance.Contrast(img).enhance(CONTRAST)
        # --- Warmth (slight orange lift) ---
        img = ImageEnhance.Color(img).enhance(WARMTH)
        # --- Shadow lift: apply per-channel gamma lift ---
        r, g, b, a = img.split()

        def lift_channel(channel):
            # Build a 256-entry lookup table: lift shadows more than highlights
            lut = []
            for i in range(256):
                v = i / 255.0
                lifted = v + SHADOW_LIFT * (1.0 - v)
                lut.append(int(min(255, max(0, round(lifted * 255)))))
            return channel.point(lut)

        r = lift_channel(r)
        g = lift_channel(g)
        b = lift_channel(b)
        img = Image.merge('RGBA', (r, g, b, a))
        # Encode back in the SAME format as input
        out = io.BytesIO()
        if in_fmt == 'JPEG':
            # JPEG doesn't support alpha; composite on white then save
            rgb = img.convert('RGB')
            rgb.save(out, format='JPEG', quality=92, subsampling=0)
        else:
            img.save(out, format='PNG')
        return out.getvalue(), True
    except Exception as e:
        print(f"    Warning: enhancement skipped ({e})")
        return buf, False


def main():
    if not GLB_PATH.exists():
        print(f"Error: {GLB_PATH} not found", file=sys.stderr)
        sys.exit(1)

    data = GLB_PATH.read_bytes()
    version, length, chunks = read_glb_chunks(data)
    print(f"GLB: version={version} length={length} chunks={len(chunks)}")

    # Separate JSON and BIN chunks
    json_chunk = None
    bin_chunk = None
    for c in chunks:
        if c['type'] == b'JSON':
            json_chunk = c
        elif c['type'] == b'BIN\x00':
            bin_chunk = c

    if json_chunk is None:
        print("Error: no JSON chunk found", file=sys.stderr)
        sys.exit(1)

    json_doc = json.loads(json_chunk['data'])

    # Find images and bufferViews referencing them
    images = json_doc.get('images', [])
    buffer_views = json_doc.get('bufferViews', [])
    buffers = json_doc.get('buffers', [])

    print(f"Images: {len(images)}, BufferViews: {len(buffer_views)}, Buffers: {len(buffers)}")

    if not images:
        print("No embedded images found — nothing to enhance.")
        return

    # Find the first image with a bufferView (embedded texture)
    target = None
    for img in images:
        bv_idx = img.get('bufferView')
        if bv_idx is None:
            continue
        bv = buffer_views[bv_idx]
        if bv.get('buffer') == 0:  # embedded in the single BIN chunk
            target = (img, bv_idx, bv)
            break

    if target is None:
        print("No embedded bufferView image found — nothing to enhance.")
        return

    img_obj, bv_idx, bv = target
    byte_offset = bv.get('byteOffset', 0)
    byte_length = bv.get('byteLength')
    # BIN chunk data
    if bin_chunk is None:
        print("Error: image references bufferView but no BIN chunk", file=sys.stderr)
        sys.exit(1)
    bin_data = bytearray(bin_chunk['data'])

    tex_buf = bytes(bin_data[byte_offset:byte_offset + byte_length])
    print(f"Texture buffer: {len(tex_buf)} bytes")

    # Enhance
    new_buf, enhanced = enhance_image(tex_buf)
    if enhanced:
        print(f"Enhanced texture: {len(tex_buf)} -> {len(new_buf)} bytes")
    else:
        new_buf = tex_buf

    # Write backup
    if not BACKUP_PATH.exists():
        shutil.copy2(GLB_PATH, BACKUP_PATH)
        print(f"Backup saved: {BACKUP_PATH}")

    # Rebuild BIN with new texture data
    old_len = len(tex_buf)
    new_len = len(new_buf)
    delta = new_len - old_len
    bin_data[byte_offset:byte_offset + old_len] = new_buf
    if delta != 0:
        print(f"Size changed by {delta} bytes; updating bufferView byteLength")
        new_bin = bin_data[:byte_offset] + new_buf + bin_data[byte_offset + old_len:]
        bin_chunk['data'] = bytes(new_bin)
        bin_chunk['len'] = len(new_bin)
        # Update bufferView byteLength in JSON
        buffer_views[bv_idx]['byteLength'] = new_len

    # Rebuild GLB
    new_glb = write_glb_chunks(data, chunks, (json_doc, bytes(bin_data)))
    GLB_PATH.write_bytes(new_glb)
    print(f"Enhanced GLB written: {GLB_PATH} ({len(new_glb)} bytes)")


if __name__ == '__main__':
    main()
