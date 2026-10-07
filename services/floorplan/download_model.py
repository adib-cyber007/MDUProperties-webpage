"""Download the official research checkpoint and verify its recorded SHA-256."""
import hashlib
from pathlib import Path

import gdown

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "models" / "model_best_val_loss_var.pkl"
EXPECTED = "dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2"


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''): value.update(chunk)
    return value.hexdigest()


if __name__ == '__main__':
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if TARGET.exists() and digest(TARGET) == EXPECTED:
        print('Official CubiCasa5K checkpoint verified; no download needed.')
    else:
        temporary = TARGET.with_suffix('.download')
        gdown.download(id='1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK', output=str(temporary), use_cookies=False)
        if not temporary.exists() or digest(temporary) != EXPECTED:
            raise RuntimeError('Checkpoint verification failed. The original published file may have changed; do not load it.')
        temporary.replace(TARGET)
        print('Downloaded and verified official CubiCasa5K checkpoint (CC BY-NC 4.0).')
