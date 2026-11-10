"""Export LightGBM numeric regression trees without executable generated code."""
import math


def export_tree(node):
    if "leaf_value" in node:
        return {"leaf": node["leaf_value"]}
    if node.get("decision_type") != "<=":
        raise ValueError("Only numeric <= splits are supported")
    if node.get("missing_type") not in ("None", "NaN"):
        raise ValueError("Zero-as-missing trees are unsupported")
    return {"feature": node["split_feature"], "threshold": float(node["threshold"]),
            "defaultLeft": bool(node["default_left"]),
            "left": export_tree(node["left_child"]), "right": export_tree(node["right_child"])}


def evaluate_tree(tree, values):
    while "leaf" not in tree:
        value = values[tree["feature"]]
        go_left = tree["defaultLeft"] if math.isnan(value) else value <= tree["threshold"]
        tree = tree["left"] if go_left else tree["right"]
    return tree["leaf"]


def export_booster(booster):
    dump = booster.dump_model()
    if dump.get("average_output"):
        raise ValueError("Averaged-output ensembles are unsupported")
    return [export_tree(info["tree_structure"]) for info in dump["tree_info"]]


def predict(trees, values):
    return sum(evaluate_tree(tree, values) for tree in trees)
