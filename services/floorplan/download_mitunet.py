"""Fetch the author's Git-LFS checkpoint; verify before exposing it to inference."""
import hashlib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "models" / "mitunet.pth"
# Hash and size published in the upstream Git-LFS pointer, not a local first download.
SHA256 = "9c56c86723b0b5099ea63c82b5cac2f9c98c1816536003a78e422b7fcfadfbaf"
SIZE = 257383307
URL = ("https://media.githubusercontent.com/media/aliasstudio/mitunet/master/"
       "experiments/models/mitunet_finetune_a6_mit_b4_tversky_8864_28E.pth")


def verify(path):
    if not path.is_file() or path.stat().st_size != SIZE:
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == SHA256


def download():
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if verify(TARGET):
        print("MitUNet checkpoint already verified.", flush=True)
        return
    temporary = TARGET.with_suffix(".download")
    try:
        request = urllib.request.Request(URL, headers={"User-Agent": "floorplan-model-setup"})
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            total, reported = 0, 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > SIZE:
                    raise RuntimeError("The upstream checkpoint exceeds its published size.")
                output.write(chunk)
                if total - reported > 32 * 1024 * 1024:
                    print(f"MitUNet download: {total * 100 // SIZE}%", flush=True)
                    reported = total
        if not verify(temporary):
            raise RuntimeError("MitUNet SHA-256 verification failed; checkpoint was not installed.")
        temporary.replace(TARGET)
        print("MitUNet checkpoint verified and installed (CC-BY-NC 4.0).", flush=True)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    download()
