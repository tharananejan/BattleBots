# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None
webapp_root = Path(SPECPATH)
backend_dir = webapp_root / "Backend"
frontend_dist = backend_dir / "frontend_dist"

if not frontend_dist.is_dir():
    raise SystemExit(
        f"Missing {frontend_dist}. Run build_app.ps1 or copy BattleBotsFrontend/dist to Backend/frontend_dist first."
    )

datas = [
    (str(frontend_dist), "frontend_dist"),
    (str(backend_dir / "game_settings.json"), "."),
    (str(backend_dir / "calibration.json"), "."),
]

hiddenimports = collect_submodules("websockets")
binaries = []
for package in ("cv2",):
    pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

a = Analysis(
    [str(backend_dir / "location.py")],
    pathex=[str(backend_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="BattleBots",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="BattleBots",
)
