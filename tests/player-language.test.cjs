const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(search = '') {
    const nodes = new Map();
    const spoken = [];
    let voices = [];
    let cancellations = 0;
    let focused;
    class Element {
        constructor(id = '', tag = 'div') {
            this.id = id; this.tag = tag; this.dataset = {}; this.style = {};
            this.attributes = new Map(); this.children = []; this.listeners = {};
            this.classes = new Set(); this.open = false; this.currentTime = 0; this.duration = 60;
            this.classList = {
                add: name => this.classes.add(name), remove: name => this.classes.delete(name),
                contains: name => this.classes.has(name),
                toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name)
            };
        }
        get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text || ''; }
        get innerText() { return this.textContent; }
        set textContent(value) { this.children = []; this.text = value; }
        replaceChildren() { this.text = ''; this.children = []; }
        appendChild(child) { this.children.push(child); }
        setAttribute(name, value) { this.attributes.set(name, String(value)); }
        getAttribute(name) { return this.attributes.get(name) || (name === 'data-speech' ? this.dataset.speech : null); }
        matches(selector) { return selector === this.tag; }
        closest() { return this.staff ? this : null; }
        addEventListener(type, callback) { this.listeners[type] = callback; }
        focus() { focused = this; }
        showModal() { this.open = true; }
        close() { this.open = false; }
        pause() { this.paused = true; }
        play() { this.paused = false; return Promise.resolve(); }
        load() {}
    }
    const element = id => {
        if (!nodes.has(id)) nodes.set(id, new Element(id, /voiceEnglish|voiceMaori|btn|Toggle/i.test(id) ? 'button' : 'div'));
        return nodes.get(id);
    };
    const voiceButton = element('voiceToggle');
    element('voiceEnglish').dataset.languageKey = 'English';
    element('voiceMaori').dataset.languageKey = 'Māori';
    element('btnPauseGame').dataset.languageKey = 'Start';
    const document = {
        getElementById: element, createElement: tag => new Element('', tag),
        get activeElement() { return focused; },
        querySelectorAll: selector => selector === '.voice-icon-btn' ? [voiceButton]
            : selector === '[data-language-key]' ? [...nodes.values()].filter(node => node.dataset.languageKey)
            : selector === '[data-interface-language-switch]' ? [...nodes.values()].filter(node => node.dataset.interfaceLanguageSwitch !== undefined)
            : selector === '[data-language-aria-label]' ? [...nodes.values()].filter(node => node.dataset.languageAriaLabel) : []
    };
    const speechSynthesis = { getVoices: () => voices, cancel: () => cancellations++, speak: utterance => spoken.push(utterance) };
    const context = vm.createContext({ document, window: { speechSynthesis, addEventListener() {} },
        location: { search }, URLSearchParams, console, setTimeout, clearTimeout, setInterval, clearInterval,
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
    });
    for (const file of ['player-language.js', 'player-language-resources.js', 'avatar-pose-controller.js', 'app.js']) {
        new vm.Script(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), {
            importModuleDynamically: async () => {
                const module = new vm.SyntheticModule([], () => {}, { context });
                await module.link(() => {}); await module.evaluate(); return module;
            }
        }).runInContext(context);
    }
    const run = code => vm.runInContext(code, context);
    return { element, nodes, context, run, voiceButton, spoken, speechSynthesis,
        setVoices: value => { voices = value; }, cancellations: () => cancellations,
        focused: () => focused };
}

test('one selected interface language renders accessible labels and survives dynamic updates', () => {
    const h = harness();
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Start')");
    const button = h.element('btnPauseGame');
    assert.deepEqual(button.children.map(child => child.lang), ['en']);
    h.run("PlayerLanguage.setLanguage('mi')");
    assert.deepEqual(button.children.map(child => child.lang), ['mi']);
    assert.equal(button.getAttribute('aria-label'), 'Tīmata');
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Resume')");
    assert.equal(button.children[0].textContent, 'Haere Tonu');
    assert.equal(button.children.length, 1);
    assert.equal(button.getAttribute('aria-label'), 'Haere Tonu');
    assert.equal(button.getAttribute('data-speech'), 'Resume the game');
    h.run("PlayerLanguage.setLanguage('en')");
    assert.deepEqual(button.children.map(child => child.lang), ['en']);
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Unreviewed user title')");
    assert.equal(button.textContent, 'Unreviewed user title');
});

test('interface switch is bilingual, independent of voice and clears confirmation state', () => {
    const h = harness();
    const button = h.element('languageToggle');
    button.dataset.interfaceLanguageSwitch = '';
    h.run("PlayerLanguage.setLanguage('en')");
    assert.equal(button.textContent, 'English / Māori');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    h.run("handleAccessibleClick(document.getElementById('languageToggle'), toggleInterfaceLanguage)");
    assert.equal(h.run('PlayerLanguage.interfaceLanguage'), 'mi');
    assert.equal(h.run('isVoiceMode'), false);
    assert.equal(h.run("PlayerLanguage.speech('Start', 'mi')"), 'Tīmata te kēmu.');
    h.run("selectVoiceLanguage('en'); handleAccessibleClick(document.getElementById('languageToggle'), toggleInterfaceLanguage)");
    assert.equal(h.run('PlayerLanguage.interfaceLanguage'), 'mi');
    assert.match(h.spoken.at(-1).text, /Interface language: Māori.*English/);
    h.run("handleAccessibleClick(document.getElementById('languageToggle'), toggleInterfaceLanguage)");
    assert.equal(h.run('PlayerLanguage.interfaceLanguage'), 'en');
    assert.equal(h.run('voiceLanguage'), 'en');
    assert.equal(h.run('currentFocusedButton'), null);
    assert.equal(h.element('voice-subtitle').style.display, 'none');
    assert.equal(button.children.length, 3);
});

test('language survives navigation, localizes nontext labels and excludes Staff', () => {
    const h = harness();
    const timeline = h.element('videoProgress');
    timeline.dataset.languageAriaLabel = 'Speed';
    const staff = h.element('staffBack');
    staff.staff = true; staff.dataset.languageKey = 'Back'; staff.textContent = 'Back';
    h.run("PlayerLanguage.setLanguage('mi'); goToScreen('screen-home')");
    assert.equal(h.run('PlayerLanguage.interfaceLanguage'), 'mi');
    assert.equal(timeline.getAttribute('aria-label'), 'Tere');
    assert.equal(staff.textContent, 'Back');
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Unknown source text')");
    assert.equal(h.element('btnPauseGame').lang, 'en');
    assert.equal(h.element('btnPauseGame').textContent, 'Unknown source text');
    h.run("PlayerLanguage.setLanguage('invalid')");
    assert.equal(h.run('PlayerLanguage.interfaceLanguage'), 'en');
});

test('Camera error is discoverable only on failure and follows interface language', () => {
    const h = harness();
    h.run("updateTrackingStatus({state: 'stopped', message: 'Camera off'})");
    assert.equal(h.element('cameraError').hidden, true);
    h.run("updateTrackingStatus({state: 'unavailable', message: 'Camera access is off'})");
    assert.equal(h.element('cameraError').hidden, false);
    assert.equal(h.element('cameraToggle').getAttribute('aria-describedby'), 'cameraError');
    h.run("PlayerLanguage.setLanguage('mi')");
    assert.equal(h.element('cameraError').lang, 'mi');
    assert.equal(h.element('cameraError').children.length, 1);
    h.run("updateTrackingStatus({state: 'loading', message: 'Starting camera…'})");
    assert.equal(h.element('cameraError').hidden, true);
    assert.equal(h.element('cameraToggle').getAttribute('aria-describedby'), null);
});

test('voice OFF opens selection; cancellation preserves OFF; English enables confirmation', () => {
    const h = harness();
    h.voiceButton.focus();
    h.run('toggleVoiceMode()');
    assert.equal(h.element('voiceLanguageDialog').open, true);
    assert.equal(h.focused(), h.element('voiceEnglish'));
    assert.match(h.spoken.at(-1).text, /English.*Māori/);
    h.run('closeVoicePanel()');
    assert.equal(h.run('isVoiceMode'), false);
    assert.equal(h.focused(), h.voiceButton);
    h.run("toggleVoiceMode(); selectVoiceLanguage('en')");
    assert.equal(h.run('isVoiceMode'), true);
    assert.equal(h.element('voiceLanguageDialog').open, false);
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Resume'); globalThis.activations = 0;");
    h.run("handleAccessibleClick(document.getElementById('btnPauseGame'), () => activations++)");
    assert.equal(h.run('activations'), 0);
    assert.equal(h.spoken.at(-1).text, 'Resume the game. Tap again to confirm.');
    assert.equal(h.element('voice-subtitle').children[0].lang, 'en');
    h.run("handleAccessibleClick(document.getElementById('btnPauseGame'), () => activations++)");
    assert.equal(h.run('activations'), 1);
    h.run('toggleVoiceMode(); closeVoicePanel()');
    assert.equal(h.run('isVoiceMode'), true);
    h.run('toggleVoiceMode(); turnVoiceOff()');
    assert.equal(h.run('isVoiceMode'), false);
    assert.equal(h.element('voiceLanguageDialog').open, false);
});

test('review status does not block Māori scripts; dynamic feedback retains focus values', () => {
    const h = harness();
    h.run("PlayerLanguage.resources.Start.status = 'approved'");
    assert.equal(h.run("PlayerLanguage.speech('Start', 'mi')"), 'Tīmata te kēmu.');
    h.run("PlayerLanguage.resources.Start.speechStatus = 'approved'");
    assert.equal(h.run("PlayerLanguage.speech('Start', 'mi')"), 'Tīmata te kēmu.');
    h.run("updateMovementFeedback('Almost - adjust your {focus}', 'almost', { focus: 'left arm bend', focusMi: 'piko ringa mauī' })");
    assert.match(h.element('movementFeedback').textContent, /left arm bend/);
    h.run("updateMovementFeedback('Almost - adjust your {focus}', 'almost', { focus: 'right arm bend', focusMi: 'piko ringa matau' })");
    assert.match(h.element('movementFeedback').textContent, /right arm bend/);
    assert.doesNotMatch(h.element('movementFeedback').textContent, /left arm bend/);
});

test('Māori is selectable without a voice; a delayed Māori voice enables audio without approval', () => {
    const h = harness();
    h.run("toggleVoiceMode(); selectVoiceLanguage('mi')");
    assert.equal(h.run('isVoiceMode'), true);
    assert.equal(h.run('voiceLanguage'), 'mi');
    assert.equal(h.element('voiceLanguageDialog').open, false);
    assert.match(h.element('voice-subtitle').textContent, /No Māori voice/);
    const count = h.spoken.length;
    h.run("speak('Start')");
    assert.equal(h.spoken.length, count);
    h.setVoices([{ name: 'Device Māori', lang: 'mi-NZ' }, { name: 'NZ English', lang: 'en-NZ' }]);
    h.speechSynthesis.onvoiceschanged();
    assert.equal(h.element('maoriVoiceNotice').hidden, true);
    assert.equal(h.run('voiceLanguage'), 'mi');
    h.run("speak('Start')");
    assert.equal(h.spoken.at(-1).text, 'Tīmata te kēmu.');
    assert.equal(h.spoken.at(-1).voice.name, 'Device Māori');
    assert.equal(h.spoken.at(-1).lang, 'mi-NZ');
    assert.equal(h.run('PlayerLanguage.resources.Start.status'), 'draft');
    h.run("selectVoiceLanguage('en')");
    assert.equal(h.spoken.at(-1).voice.name, 'NZ English');
});

test('Māori audio retains two-click confirmation and never reads editorial notes', () => {
    const h = harness();
    h.setVoices([{name: 'Māori device voice', lang: 'mi'}]);
    h.speechSynthesis.onvoiceschanged();
    h.run("selectVoiceLanguage('mi'); globalThis.actions = 0; PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Start')");
    h.run("handleAccessibleClick(document.getElementById('btnPauseGame'), () => actions++)");
    assert.equal(h.run('actions'), 0);
    assert.match(h.spoken.at(-1).text, /Tīmata te kēmu.*Pāwhiritia anō/);
    assert.equal(h.spoken.at(-1).lang, 'mi');
    h.run("handleAccessibleClick(document.getElementById('btnPauseGame'), () => actions++)");
    assert.equal(h.run('actions'), 1);
    for (const key of ['Full Screen', 'Split Screen', '{gameName}']) {
        const text = h.run(`PlayerLanguage.speech(${JSON.stringify(key)}, 'mi', {gameName:'Demo'})`);
        assert.doesNotMatch(text, /Button:|Announcement:|Translation|requires.*review/);
    }
});

test('language choices use two-click confirmation when ON; Staff actions stay direct and silent', () => {
    const h = harness();
    h.run("selectVoiceLanguage('en'); toggleVoiceMode()");
    h.run("handleAccessibleClick(document.getElementById('voiceEnglish'), () => selectVoiceLanguage('en'))");
    assert.equal(h.element('voiceLanguageDialog').open, true);
    h.run("handleAccessibleClick(document.getElementById('voiceEnglish'), () => selectVoiceLanguage('en'))");
    assert.equal(h.element('voiceLanguageDialog').open, false);
    h.element('staffBack').staff = true;
    const count = h.spoken.length;
    h.run("globalThis.staffActions = 0; handleAccessibleClick(document.getElementById('staffBack'), () => staffActions++)");
    assert.equal(h.run('staffActions'), 1);
    assert.equal(h.spoken.length, count);
});

test('navigation cancels pending speech, focus and subtitle timers', () => {
    const h = harness();
    h.run("selectVoiceLanguage('en'); handleAccessibleClick(document.getElementById('btnPauseGame'), () => {});");
    assert.ok(h.run('currentFocusedButton'));
    const cancelled = h.cancellations();
    h.run("goToScreen('screen-home')");
    assert.equal(h.run('currentFocusedButton'), null);
    assert.ok(h.cancellations() > cancelled);
    assert.equal(h.element('voice-subtitle').style.display, 'none');
});

test('optional game metadata requires approval and switching to source-only content clears old markup', () => {
    const h = harness();
    h.run("renderGameMetadata(document.getElementById('gameTitleDisplay'), { id: 1, name: 'Source', nameMi: 'Reviewed title', languageApproval: 'draft' }, 'name', 'Fallback')");
    assert.equal(h.element('gameTitleDisplay').textContent, 'Source');
    h.run("renderGameMetadata(document.getElementById('gameTitleDisplay'), { id: 1, name: 'Source', nameMi: 'Reviewed title', languageApproval: 'approved' }, 'name', 'Fallback')");
    assert.deepEqual(h.element('gameTitleDisplay').children.map(child => child.lang), ['en']);
    h.run("PlayerLanguage.setLanguage('mi')");
    assert.equal(h.element('gameTitleDisplay').textContent, 'Reviewed title');
    h.run("renderGameMetadata(document.getElementById('gameTitleDisplay'), { id: 2, name: 'Next source' }, 'name', 'Fallback'); PlayerLanguage.setLanguage('mi')");
    assert.equal(h.element('gameTitleDisplay').textContent, 'Next source');
});
