"""Seal/verify a Linux release, its locked UI assets and pre-acquired OCR weights."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path

OCR_WEIGHTS = {
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    "PP-OCRv6_det_small.onnx": "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    "PP-OCRv6_rec_small.onnx": "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
}


def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def ocr_paths():
    root = Path(importlib.metadata.distribution("rapidocr").locate_file("rapidocr/models"))
    for name, expected in OCR_WEIGHTS.items():
        if not (root / name).is_file() or sha(root / name) != expected:
            raise ValueError("OCR weights absent or inconsistent; acquire and verify before service start")
    return root


def inventory(path):
    values = json.loads(path.read_text(encoding="utf-8"))
    used = {key: set() for key in ("name", "uid", "port", "origin", "data_dir", "credential_dir")}
    from .instance import InstanceProfile
    for row in values:
        for key in used:
            if row[key] in used[key]:
                raise ValueError(f"Duplicate {key} in instance inventory")
            used[key].add(row[key])
        if not 1024 <= row["port"] <= 65535 or row["uid"] <= 0:
            raise ValueError("Invalid UID or port")
        InstanceProfile("beta", row["origin"], Path(row["credential_dir"])).validate(Path(row["data_dir"]), "127.0.0.1", 1)
    roots = [Path(row[key]).resolve() for row in values for key in ("data_dir", "credential_dir")]
    for i, root in enumerate(roots):
        if any(root == other or root in other.parents or other in root.parents for other in roots[i+1:]):
            raise ValueError("Instance roots overlap")
    return {"instances": len(values), "status": "VALIDATED"}


def release_files(root):
    files = {}
    for folder in ("src", "node_modules/pdfjs-dist/build", "node_modules/marked/lib", "node_modules/dompurify/dist", "node_modules/katex/dist"):
        for file in (root / folder).rglob("*"):
            if file.is_file() and "__pycache__" not in file.parts:
                files[file.relative_to(root).as_posix()] = sha(file)
    for name in ("package-lock.json", "deploy/beta/requirements.lock", "RELEASE_COMMIT"):
        files[name] = sha(root / name)
    for name in ("node_modules/pdfjs-dist/build/pdf.mjs", "node_modules/marked/lib/marked.esm.js", "node_modules/dompurify/dist/purify.es.mjs", "node_modules/katex/dist/katex.mjs"):
        if name not in files:
            raise ValueError("Missing locked browser asset")
    for line in (root / "deploy/beta/requirements.lock").read_text().splitlines():
        if line and not line.startswith("#"):
            name, version = line.split("==")
            if importlib.metadata.version(name) != version:
                raise ValueError(f"Dependency version mismatch: {name}")
    ocr_paths()
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("seal", "verify", "inventory"))
    parser.add_argument("--root", type=Path)
    parser.add_argument("--inventory", type=Path)
    args = parser.parse_args()
    if args.action == "inventory":
        print(json.dumps(inventory(args.inventory)))
        return
    root = args.root.resolve()
    files = release_files(root)
    manifest = root / "release-manifest.json"
    if args.action == "seal":
        manifest.write_text(json.dumps({"format": 1, "files": files, "ocr": OCR_WEIGHTS}, indent=2) + "\n", encoding="utf-8")
    else:
        saved = json.loads(manifest.read_text(encoding="utf-8"))
        if saved != {"format": 1, "files": files, "ocr": OCR_WEIGHTS}:
            raise ValueError("Release hash verification failed")
    print(json.dumps({"status": "VERIFIED", "files": len(files)}))


if __name__ == "__main__":
    main()
