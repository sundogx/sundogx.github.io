#!/bin/sh
# Builds compiled.js and compiled.wasm (DDS, the double-dummy solver) with Emscripten.
# Usage: js/wasm/build.sh [path to the DDS sources]   (needs em++, e.g. `brew install emscripten`)
# Without a path it downloads the DDS sources @bridge-tools/dd 0.2.2 was built from: github.com/aaron-hutton/dds
# at 860e618 (DDS 2.9.0 by Bo Haglund and Soren Hein, Apache-2.0, with small changes to build for WebAssembly).
# Differences from the npm build: optimised (-O3, no assertions, minified glue), memory starts at 16 MB and grows
# as needed (the npm build reserved a fixed 50 MB per instance), no file system, and dds_reset (dds_wrapper.cpp).
set -e
here=$(cd "$(dirname "$0")" && pwd)
src=$1
if [ -z "$src" ]; then
  tmp=$(mktemp -d)
  curl -sL https://codeload.github.com/aaron-hutton/dds/tar.gz/860e61802a77322249dfdec9ea25f39544b511d5 | tar xz -C "$tmp"
  src="$tmp/dds-860e61802a77322249dfdec9ea25f39544b511d5"
fi
s="$src/src"
em++ -O3 -flto -fno-exceptions -I "$s" \
  "$here/dds_wrapper.cpp" \
  "$s/ABsearch.cpp" "$s/ABstats.cpp" "$s/CalcTables.cpp" "$s/dds.cpp" "$s/DealerPar.cpp" "$s/dump.cpp" "$s/File.cpp" \
  "$s/Init.cpp" "$s/LaterTricks.cpp" "$s/Memory.cpp" "$s/Moves.cpp" "$s/PBN.cpp" "$s/PlayAnalyser.cpp" "$s/QuickTricks.cpp" \
  "$s/Scheduler.cpp" "$s/SolveBoard.cpp" "$s/SolverIF.cpp" "$s/System.cpp" "$s/ThreadMgr.cpp" "$s/Timer.cpp" \
  "$s/TimerGroup.cpp" "$s/TimerList.cpp" "$s/TimeStat.cpp" "$s/TimeStatList.cpp" "$s/TransTableL.cpp" "$s/TransTableS.cpp" \
  -sMODULARIZE=1 -sEXPORT_NAME=create_dds_module -sENVIRONMENT=web,worker,node \
  -sASSERTIONS=0 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16MB -sSTACK_SIZE=1MB \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_dds_init,_dds_reset,_dds_solve_board -sEXPORTED_RUNTIME_METHODS=setValue,getValue \
  -o "$here/compiled.js"
ls -l "$here/compiled.js" "$here/compiled.wasm"
