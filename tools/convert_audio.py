"""Convierte todos los .ogg de public/audio a .mp3 (Safari/iOS no decodifica bien OGG Vorbis).

Uso: python tools/convert_audio.py [--force]
Requiere ffmpeg en el PATH (valen versiones antiguas: no se usan -hide_banner ni -to de entrada).
- Efectos: mono, 22050 Hz, ~64 kbps.
- Música (music_*.ogg): estéreo, 44100 Hz, ~128 kbps.
"""
import subprocess
import sys
from pathlib import Path

AUDIO = Path(__file__).resolve().parent.parent / "public" / "audio"


def convert(src: Path, force: bool) -> str:
    dst = src.with_suffix(".mp3")
    if dst.exists() and not force and dst.stat().st_mtime >= src.stat().st_mtime:
        return "ok (ya existe)"
    music = src.stem.startswith("music_")
    ch, rate, br = ("2", "44100", "128k") if music else ("1", "22050", "64k")
    cmd = ["ffmpeg", "-y", "-i", str(src), "-vn", "-ac", ch, "-ar", rate,
           "-codec:a", "libmp3lame", "-b:a", br, str(dst)]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0 or not dst.exists():
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[-400:])
    return f"{dst.stat().st_size / 1024:.0f} KB"


def main() -> int:
    force = "--force" in sys.argv
    files = sorted(AUDIO.glob("*.ogg"))
    fails = 0
    for f in files:
        try:
            print(f"{f.name}: {convert(f, force)}")
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"{f.name}: ERROR {e}")
    total = sum(p.stat().st_size for p in AUDIO.glob("*.mp3"))
    print(f"{len(files)} ogg, {len(list(AUDIO.glob('*.mp3')))} mp3, {total / 1024 / 1024:.2f} MB de mp3")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
