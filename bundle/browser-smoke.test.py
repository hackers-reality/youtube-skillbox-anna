"""Real Anna host smoke tests; workspace storage is an isolated test fixture.

Run against anna-app dev on :5181 with Python Playwright and an installed Edge:
  python bundle/browser-smoke.test.py
No writes are forwarded to APS; no verified profile or account data is cleared.
"""
import io
import json
import os
from pathlib import Path
import zipfile
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("SKILLBOX_TEST_URL", "http://localhost:5181")
OUTPUT = Path(os.environ.get("SKILLBOX_EVIDENCE_DIR", "browser-test-evidence"))
OUTPUT.mkdir(parents=True, exist_ok=True)


def run():
    results = []
    data = {"youtube-skillbox:guest": [True]}
    writes = []
    with sync_playwright() as p:
        edge = os.environ.get("SKILLBOX_BROWSER", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
        browser = p.chromium.launch(executable_path=edge if Path(edge).exists() else None, headless=True, timeout=60000)
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)

        def storage_fixture(route):
            body = route.request.post_data_json
            if body.get("ns") != "storage":
                route.continue_()
                return
            args = body.get("args", {})
            key = args.get("key")
            if body["method"] == "get":
                value = {"value": data.get(key)}
            elif body["method"] == "set":
                data[key] = args["value"]
                writes.append(key)
                value = {"ok": True}
            else:
                raise AssertionError("Unexpected storage method: " + body["method"])
            route.fulfill(json={"ok": True, "result": value})

        context.route("**/api/session/call", storage_fixture)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        app = page.frame_locator("#app")
        expect(app.locator("#status-text")).to_have_text("Connected to Anna host", timeout=30000)
        expect(app.locator("#workspace-status")).to_contain_text("Workspace loaded", timeout=30000)
        app.locator("#onboarding-close").click()
        expect(app.locator("#tour-dialog")).to_be_visible(timeout=10000)
        for _ in range(5): app.locator("#tour-next").click()
        expect(app.locator("#tour-title")).to_have_text("Keep the work moving")
        app.locator("#tour-next").click()
        assert app.locator("main > .wrap > .panel").count() == 6
        for name in ["audit", "studio", "retention", "analytics", "workspace", "chat"]:
            app.locator("#tab-button-" + name).click()
            expect(app.locator("#tab-" + name)).to_be_visible()
            expect(app.locator(".panel.is-active")).to_have_count(1)
        app.locator("#tab-button-chat").focus()
        app.locator("#tab-button-chat").press("ArrowRight")
        expect(app.locator("#tab-audit")).to_be_visible()
        for _ in range(3):
            app.locator("#theme-toggle").click()
        app.locator("#rail-toggle").click()
        app.locator("#rail-toggle").click()
        results.append("Host handshake, all 6 sibling tabs, keyboard navigation, theme cycle and rail passed")

        app.locator("#tab-button-analytics").click()
        app.locator("#analytics-handle").fill("@test")
        app.locator("#analytics-run").click()
        expect(app.locator("#analytics-output")).to_contain_text("select an authorized channel", timeout=5000)
        assert app.locator("#analytics-export").is_disabled()
        results.append("Private Analytics fails closed without OAuth; no private metrics fabricated")

        app.locator("#tab-button-studio").click()
        app.locator("#studio-topic").fill("A short checklist for reviewing a draft before publishing")
        app.locator("[data-task=brief]").click()
        expect(app.locator("#studio-task-label")).to_have_text("CREATIVE BRIEF", timeout=90000)
        assert app.locator("#studio-pre").inner_text().strip()
        assert not app.locator("#studio-pre").inner_text().startswith("Error:")
        app.locator("#studio-save").click()
        expect(app.locator("#workspace-projects .workspace-item")).to_have_count(1)
        app.locator("#studio-save").click()
        expect(app.locator("#workspace-projects .workspace-item")).to_have_count(2)
        app.locator("#tab-button-workspace").click()
        app.locator("[data-project-copy]").first.click()
        expect(app.locator("#workspace-projects .workspace-item")).to_have_count(3)
        app.locator("[data-project-open]").first.click()
        expect(app.locator("#workspace-dialog")).to_be_visible()
        assert app.locator(".workspace-preview").inner_text().strip()
        app.locator("#workspace-dialog-cancel").click()
        results.append("Real Anna-generated brief; save two versions, duplicate, reopen passed (isolated storage)")

        app.locator(".add-task-btn[data-status=backlog]").click()
        app.locator("#workspace-dialog input[name=title]").fill("BROWSER TEST FIXTURE — produce video")
        app.locator("#workspace-dialog select[name=projectId]").select_option(index=1)
        app.locator("#workspace-dialog-save").click()
        expect(app.locator(".kanban-column[data-status=backlog] .workspace-task")).to_have_count(1)
        app.locator("[data-task-edit]").click()
        app.locator("#workspace-dialog select[name=status]").select_option("review")
        app.locator("#workspace-dialog-save").click()
        expect(app.locator(".kanban-column[data-status=review] .workspace-task")).to_have_count(1)
        app.locator(".workspace-task").drag_to(app.locator(".kanban-column[data-status=production]"))
        expect(app.locator(".kanban-column[data-status=production] .workspace-task")).to_have_count(1)

        app.locator("[data-calendar-add]").first.click()
        app.locator("#workspace-dialog input[name=title]").fill("BROWSER TEST FIXTURE — content plan")
        app.locator("#workspace-dialog-save").click()
        expect(app.locator(".calendar-entry")).to_have_count(1)
        app.locator(".calendar-entry").drag_to(app.locator(".calendar-day").nth(1))
        app.locator("[data-event-edit]").click()
        app.locator("#workspace-dialog input[name=date]").fill("2027-01-15")
        app.locator("#workspace-dialog-save").click()
        assert data["youtube-skillbox:workspace-calendar"][0]["date"] == "2027-01-15"
        app.locator("#cal-next").click()
        app.locator("#cal-prev").click()
        results.append("Linked Kanban creation/edit/drag-drop, calendar creation/drag/reschedule/month controls passed")

        app.locator("#workspace-add-channel").click()
        app.locator("#workspace-dialog input[name=handle]").fill("@MrBeast")
        app.locator("#workspace-dialog-save").click()
        app.locator("[data-channel-select]").click()
        expect(app.locator("#audit-handle")).to_have_value("@MrBeast")
        assert "youtube-skillbox:profile" not in writes
        app.locator("#retention-settings").click()
        app.locator("#workspace-dialog input[name=days]").fill("90")
        app.locator("#workspace-dialog-save").click()
        assert data["youtube-skillbox:workspace-settings"][0]["retentionDays"] == 90
        with page.expect_download() as download:
            app.locator("#export-workspace-csv").click()
        path = download.value.path()
        assert Path(path).read_text(encoding="utf-8").startswith('"kind","id"')
        with page.expect_download() as download:
            app.locator("#export-workspace").click()
        exported = json.loads(Path(download.value.path()).read_text(encoding="utf-8"))
        assert exported["schemaVersion"] == 1 and len(exported["records"]) == 6
        results.append("Public context selection preserves identity; retention policy and real JSON/CSV downloads passed")

        # Destructive-path verification only affects intercepted test fixtures.
        app.locator("#delete-workspace").click()
        app.locator("#workspace-dialog input[name=confirmation]").fill("NO")
        app.locator("#workspace-dialog-save").click()
        expect(app.locator("#workspace-dialog-error")).to_have_text("Type DELETE exactly")
        app.locator("#workspace-dialog-cancel").click()
        assert len(data["youtube-skillbox:workspace-projects"]) == 3
        page.locator("#app").evaluate("iframe => iframe.contentWindow.location.reload()")
        expect(app.locator("#workspace-status")).to_contain_text("Workspace loaded", timeout=30000)
        app.locator("#onboarding-close").click()
        app.locator("#tab-button-workspace").click()
        expect(app.locator("#workspace-projects .workspace-item")).to_have_count(3)
        expect(app.locator(".workspace-task")).to_have_count(1)
        results.append("Invalid deletion confirmation leaves fixture data intact; projects/tasks survive iframe reload")

        app.locator("body").screenshot(path=str(OUTPUT / "workspace-desktop.png"))
        app.locator("#tab-button-retention").click()
        csv = "Video position (%),Audience retention (%)\n0,95\n25,72\n50,60\n75,48\n100,35\n"
        app.locator("#ret-csv").fill(csv)
        app.locator("#ret-analyze").click()
        expect(app.locator("#ret-next")).to_be_visible(timeout=90000)
        before = app.locator(".ret-card.is-active").inner_text()
        app.locator("#ret-next").click()
        assert app.locator(".ret-card.is-active").inner_text() != before
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("BROWSER TEST FIXTURE/retention.csv", csv)
            z.writestr("BROWSER TEST FIXTURE/second.csv", csv.replace("95", "90"))
        app.locator("#ret-file").set_input_files({"name": "BROWSER TEST FIXTURE.zip", "mimeType": "application/zip", "buffer": archive.getvalue()})
        expect(app.locator("#ret-analyze-all")).to_be_visible(timeout=10000)
        app.locator("#ret-analyze-all").click()
        expect(app.locator("#bundle-next")).to_be_visible(timeout=90000)
        app.locator("#bundle-next").click()
        expect(app.locator(".ret-bundle-deck.is-shuffling")).to_have_count(0, timeout=10000)
        app.locator("#ret-motion-toggle").click()
        app.locator("#bundle-prev").click()
        results.append("Real Executa analysis of synthetic CSV/ZIP fixtures, retention next/back and motion toggle passed")
        app.locator("#tab-button-workspace").click()
        page.locator("#frame").evaluate("frame => { frame.style.width='390px'; frame.style.height='844px'; }")
        expect(app.locator("#tab-workspace")).to_be_visible()
        app.locator("#retention-settings").click()
        expect(app.locator("#workspace-dialog")).to_be_visible()
        app.locator("#workspace-dialog-cancel").click()
        app.locator("body").screenshot(path=str(OUTPUT / "workspace-mobile.png"))
        app.locator("#delete-workspace").click()
        app.locator("#workspace-dialog input[name=confirmation]").fill("DELETE")
        app.locator("#workspace-dialog-save").click()
        expect(app.locator("#workspace-projects .workspace-item")).to_have_count(0)
        assert data["youtube-skillbox:workspace-tasks"] == []
        assert data["youtube-skillbox:workspace-calendar"] == []
        assert data["youtube-skillbox:workspace-channels"] == []
        results.append("Typed deletion confirmation clears only isolated workspace fixture collections")
        results.append("390px responsive workspace and native sandbox dialog passed")
        assert not errors, errors
        assert "youtube-skillbox:profile" not in writes
        assert "youtube-skillbox:oauth-tokens" not in writes
        (OUTPUT / "results.json").write_text(json.dumps({"passed": results, "pageErrors": errors, "storage": "isolated test fixture; no APS writes forwarded", "llm": "real Anna host", "tools": "real source Executa; synthetic retention inputs"}, indent=2), encoding="utf-8")
        print(json.dumps({"passed": results, "pageErrors": errors}, indent=2))
        browser.close()


if __name__ == "__main__":
    run()
