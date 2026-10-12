#!/usr/bin/env bash
# Checks that each data rule really fails the build: breaks one data file at a time, builds, then restores it.
# Run from the repo root with `npm run test:rules`. Needs a clean build to start from.
set -u
D=src/data
failures=0

try() { # description, file, sed expression that breaks it
  cp "$2" "$2.bak"
  sed -i.tmp -e "$3" "$2" && rm -f "$2.tmp"
  if npm run build >/dev/null 2>&1; then
    echo "NOT CAUGHT  $1"
    failures=$((failures + 1))
  else
    echo "caught      $1"
  fi
  mv "$2.bak" "$2"
}

try "period ends before it starts" $D/brands/omega.yaml 's/{ from: 1848 }/{ from: 1848, to: 1800 }/'
try "earlier period left open-ended" $D/lines/rolex/milgauss.yaml 's/{ from: 1956, to: 1988 }/{ from: 1956 }/'
try "overlapping periods" $D/lines/rolex/milgauss.yaml 's/{ from: 2007, to: 2023 }/{ from: 1980, to: 2023 }/'
try "independent brand with a current owner" $D/brands/omega.yaml 's/^segment: /independent: true\
segment: /'
try "two current owners" $D/brands/girard-perregaux.yaml '/to: 2022/d'
try "two references with the same URL" $D/models/rolex/submariner/submariner.yaml 's/ref: "124060"/ref: "114060"/'
try "line filed under the wrong brand" $D/lines/rolex/milgauss.yaml 's/^brand: rolex$/brand: omega/'
try "model filed under the wrong line" $D/models/rolex/submariner/submariner.yaml 's#^line: rolex/submariner$#line: rolex/datejust#'
try "status set alongside periods" $D/brands/omega.yaml 's/^segment: /status: active\
segment: /'

exit $failures
