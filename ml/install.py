"""Bundle an evaluated artifact only after rechecking the shipped TS runtime."""
import argparse
import json
import os
import subprocess
from pathlib import Path

from .collect import atomic_json
from .features import FEATURE_NAMES


def install(artifact, repository):
    artifact = Path(artifact).resolve()
    repository = Path(repository).resolve()
    model = json.loads((artifact / "model.json").read_text())
    report = json.loads((artifact / "report.json").read_text())
    fixture = json.loads((artifact / "parity.json").read_text())
    required = ("temporalPassed", "usersPassed", "parityPassed", "runtimeParityPassed", "genuineData", "retrospectiveAcknowledged")
    if not model.get("validated") or not report.get("validated"):
        raise ValueError("Artifact is disabled: a candidate that failed evaluation cannot be bundled")
    if any(not model.get("gate", {}).get(key) for key in required) or model["gate"].get("mechanicsOnly", True):
        raise ValueError("Artifact must pass every real-data, accuracy, coverage, and parity gate")
    if model.get("schemaVersion") != 1 or model.get("featureNames") != FEATURE_NAMES:
        raise ValueError("Incompatible feature schema")
    if fixture.get("model") != model or report.get("version") != model.get("version") or report.get("gate") != model["gate"]:
        raise ValueError("Model, report, and parity fixture do not describe the same artifact")
    environment = dict(os.environ, CFCHART_PARITY_FIXTURE=str(artifact / "parity.json"))
    subprocess.run([str(repository / "node_modules" / ".bin" / "vitest"), "run", "src/ml/__tests__/forecast.test.ts"],
                   cwd=repository, env=environment, check=True, timeout=120)
    destination = repository / "src" / "ml"
    if not (destination / "inference.ts").exists():
        raise ValueError("Destination is not a CFChart repository")
    atomic_json(destination / "model.json", model)
    (destination / "registry.ts").write_text(
        "// Installed by python -m ml.install after evaluation and runtime parity checks.\n"
        "import model from './model.json';\n"
        "import type { ForecastModel } from './inference';\n"
        "export const bundledForecastModel = model as unknown as ForecastModel;\n")
    return model["version"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        version = install(args.artifact, args.repo)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.error(str(error))
    print(f"Bundled evaluated model {version}. Rebuild and reload the extension.")


if __name__ == "__main__":
    main()
