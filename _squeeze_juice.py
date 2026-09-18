import subprocess
from pathlib import Path

FFMPEG = r"C:\Users\Wxcked\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"
SRC = Path(r"C:\Users\Wxcked\Desktop\mailer-app\public\assets\music\juice")
OUT = SRC.parent / "juice-128"
OUT.mkdir(exist_ok=True)

for f in sorted(SRC.glob("*.mp3")):
    dest = OUT / f.name
    if dest.exists() and dest.stat().st_size > 50_000:
        print("skip", f.name, dest.stat().st_size)
        continue
    r = subprocess.run(
        [FFMPEG, "-y", "-i", str(f), "-codec:a", "libmp3lame", "-b:a", "128k", "-ac", "2", str(dest)],
        capture_output=True,
    )
    ok = dest.exists() and dest.stat().st_size > 50_000 and r.returncode == 0
    print(("ok" if ok else "FAIL"), f.name, dest.stat().st_size if dest.exists() else 0)
    if not ok:
        print(r.stderr[-400:].decode("utf-8", "ignore"))
