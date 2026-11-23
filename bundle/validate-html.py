"""Fail on malformed markup rather than relying on HTMLParser's forgiving mode."""
from html.parser import HTMLParser
from pathlib import Path

VOID = set("area base br col embed hr img input link meta param source track wbr".split())
PANELS = {"chat", "audit", "studio", "retention", "analytics", "workspace"}


class Validator(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.ids = set()
        self.panels = set()
        self.tabs = set()
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        assert len(attrs) == len(data), f"Duplicate attributes at line {self.getpos()[0]}"
        node_id = data.get("id", "")
        if node_id:
            assert node_id not in self.ids, f"Duplicate ID {node_id}"
            self.ids.add(node_id)
        if tag == "section" and node_id.startswith("tab-"):
            assert self.stack[-2:] == [("main", "app-main"), ("div", "wrap")], f"Nested/misplaced panel {node_id}"
            self.panels.add(node_id.removeprefix("tab-"))
        if "data-tab" in data:
            self.tabs.add(data["data-tab"])
            assert data.get("aria-controls") == "tab-" + data["data-tab"]
        if tag == "script":
            self.scripts.append((data.get("src"), data.get("type")))
        if tag not in VOID:
            self.stack.append((tag, node_id or data.get("class", "")))

    def handle_startendtag(self, tag, attrs):
        foreign = any(parent[0] == "svg" for parent in self.stack)
        assert tag in VOID or foreign, f"Invalid self-closing non-void tag {tag}"
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1][0] == tag, f"Mismatched </{tag}> at line {self.getpos()[0]}: {self.stack[-3:]}"
        self.stack.pop()


def validate():
    parser = Validator()
    parser.feed(Path(__file__).with_name("index.html").read_text(encoding="utf-8"))
    parser.close()
    assert not parser.stack, f"Unclosed tags: {parser.stack}"
    assert parser.panels == parser.tabs == PANELS
    assert parser.scripts == [("anna-tool-ids.js", None), ("app.js", "module")]
    assert {"onboarding-modal", "workspace-dialog", "status-text", "workspace-status"} <= parser.ids
    print("Strict HTML validation passed: balanced tags, unique IDs/attributes, 6 sibling panels, script entry points")


if __name__ == "__main__":
    validate()
