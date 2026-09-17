"""Package the Vite build for an itch.io HTML5 upload."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    dist = root / "dist"
    if not (dist / "index.html").is_file():
        raise SystemExit("Missing dist/index.html; run npm run build first.")

    archive = root / "release" / "factory2d-itch.zip"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as output:
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                output.write(path, path.relative_to(dist).as_posix())

    print(f"{archive} ({archive.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
