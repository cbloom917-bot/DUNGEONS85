// Dungeons '85 Public Beta 9.7.3.4 — 10-version.js
// Reads the running server version from package.json through /version.

async function hydrateVersionDisplay() {
    const versionDisplay = document.getElementById('version-display');
    if (!versionDisplay) return;

    try {
        const response = await fetch('/version', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Version request failed: ${response.status}`);

        const data = await response.json();
        if (data && data.version) {
            versionDisplay.textContent = `VERSION ${data.version} PUBLIC BETA`;
        }
    } catch (err) {
        console.warn('Unable to load app version:', err);
        versionDisplay.textContent = 'VERSION PUBLIC BETA';
    }
}

hydrateVersionDisplay();
