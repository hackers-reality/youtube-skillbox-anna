"""Render actual public engine results, with isolated browser storage.

Generate browser-test-evidence/audit-media.json and home-media.json using the
source plugin first. Only a deliberately stale image request is mocked below.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent.parent


def run():
    evidence = json.loads((HERE / "browser-test-evidence/audit-media.json").read_text(encoding="utf-8"))
    home = json.loads((HERE / "browser-test-evidence/home-media.json").read_text(encoding="utf-8"))["data"]
    if isinstance(home, list): home = {"items": home}
    output = HERE / "browser-test-evidence"
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", headless=True)
        context = browser.new_context(viewport={"width":1600, "height":1000})
        def storage(route):
            request = route.request.post_data_json
            if request.get("ns") == "storage":
                route.fulfill(json={"ok":True, "result":{"value":[True] if request.get("args", {}).get("key") == "youtube-skillbox:guest" else []}})
            else: route.continue_()
        context.route("**/api/session/call", storage)
        context.route("**/STALE_TEST_AVATAR", lambda route: route.fulfill(status=404, body="Explicit stale-avatar test"))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://localhost:5181/", wait_until="domcontentloaded")
        app = page.frame_locator("#app")
        expect(app.locator("#workspace-status")).to_contain_text("Workspace loaded", timeout=30000)
        app.locator("#onboarding-close").click()
        expect(app.locator("#tour-dialog")).to_be_visible(timeout=10000)
        app.locator("#tour-close").click()
        frame = page.locator("#app").content_frame
        frame.locator("#tab-button-audit").click()
        frame.locator("body").evaluate("async (_, data) => { const {renderAuditCards} = await import('./app.js'); const output = document.getElementById('audit-result'); output.innerHTML=renderAuditCards('@MrBeast', data, 'Read-only public media verification'); output.classList.remove('hidden'); }", evidence)
        images = app.locator("#audit-result img[data-media]")
        expected_count = len(evidence["videos"]["items"]) + len(evidence["shorts"]["items"])
        expect(images).to_have_count(expected_count)
        for index in range(expected_count):
            image = images.nth(index)
            image.scroll_into_view_if_needed()
            expect(image).to_have_attribute("data-media-state", "loaded", timeout=30000)
            assert image.evaluate("image => image.naturalWidth > 120")
        app.locator("body").screenshot(path=str(output / "audit-thumbnails.png"))

        channels = [item for section in home["items"] for item in section.get("items", []) if item.get("kind") == "channel"]
        assert len(channels) >= 2
        channels[1]["thumbnail"] = "https://yt3.googleusercontent.com/STALE_TEST_AVATAR"
        frame.locator("body").evaluate("async (_, data) => { const {renderShelves} = await import('./app.js'); document.getElementById('audit-explorer-result').innerHTML=renderShelves(data); }", home)
        shorts = app.locator(".shelf-item.is-short img[data-media]")
        assert shorts.count() > 0
        for index in range(min(5, shorts.count())):
            image = shorts.nth(index)
            image.scroll_into_view_if_needed()
            expect(image).to_have_attribute("data-media-state", "loaded", timeout=30000)
            assert "/frame0.jpg" not in image.get_attribute("src")
        avatars = app.locator(".shelf-channel-preview img[data-media=channel]")
        expect(avatars).to_have_count(len(channels))
        for index in range(len(channels)):
            image = avatars.nth(index)
            image.scroll_into_view_if_needed()
            expect(image).to_have_attribute("data-media-state", "loaded", timeout=60000)
        assert "STALE_TEST_AVATAR" not in avatars.nth(1).get_attribute("src")
        app.locator("body").screenshot(path=str(output / "featured-channel-avatars.png"))
        assert not errors, errors
        result = {"audit_images_loaded":expected_count, "shorts_regular_thumbnails_checked":min(5, shorts.count()), "featured_avatars_loaded":len(channels), "stale_avatar_refreshed":True, "pageErrors":errors, "data":"Actual public source-engine outputs; browser storage isolated; one stale image response deliberately 404"}
        (output / "media-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result, indent=2))
        browser.close()


if __name__ == "__main__": run()
