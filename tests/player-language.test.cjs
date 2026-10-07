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
            : selector === '[data-language-key]' ? [...nodes.values()].filter(node => node.dataset.languageKey) : []
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

test('draft preview opt-in renders Māori above English and survives dynamic updates', () => {
    const h = harness();
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Start')");
    const button = h.element('btnPauseGame');
    assert.deepEqual(button.children.map(child => child.lang), ['en']);
    h.run('PlayerLanguage.setPreview(true)');
    assert.deepEqual(button.children.map(child => child.lang), ['mi', 'en']);
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Resume')");
    assert.equal(button.children[0].textContent, 'Haere Tonu');
    assert.equal(button.children[1].textContent, 'Resume');
    assert.equal(button.getAttribute('data-speech'), 'Resume the game');
    h.run('PlayerLanguage.setPreview(false)');
    assert.deepEqual(button.children.map(child => child.lang), ['en']);
    h.run("PlayerLanguage.render(document.getElementById('btnPauseGame'), 'Unreviewed user title')");
    assert.equal(button.textContent, 'Unreviewed user title');
});

test('voice OFF opens selection; cancellation preserves OFF; English enables confirmation', () => {
    const h = harness('?draftLanguage=1');
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
    assert.equal(h.element('voice-subtitle').children[0].lang, 'mi');
    h.run("handleAccessibleClick(document.getElementById('btnPauseGame'), () => activations++)");
    assert.equal(h.run('activations'), 1);
    h.run('toggleVoiceMode(); closeVoicePanel()');
    assert.equal(h.run('isVoiceMode'), true);
    h.run('toggleVoiceMode(); turnVoiceOff()');
    assert.equal(h.run('isVoiceMode'), false);
    assert.equal(h.element('voiceLanguageDialog').open, false);
});

test('written approval alone cannot enable Māori speech; dynamic feedback retains focus values', () => {
    const h = harness('?draftLanguage=1');
    h.run("PlayerLanguage.resources.Start.status = 'approved'");
    assert.equal(h.run("PlayerLanguage.speech('Start', 'mi')"), null);
    h.run("PlayerLanguage.resources.Start.speechStatus = 'approved'");
    assert.equal(h.run("PlayerLanguage.speech('Start', 'mi')"), 'Tīmata te kēmu.');
    h.run("updateMovementFeedback('Almost - adjust your {focus}', 'almost', { focus: 'left arm bend', focusMi: 'piko ringa mauī' })");
    assert.match(h.element('movementFeedback').textContent, /left arm bend/);
    h.run("updateMovementFeedback('Almost - adjust your {focus}', 'almost', { focus: 'right arm bend', focusMi: 'piko ringa matau' })");
    assert.match(h.element('movementFeedback').textContent, /right arm bend/);
    assert.doesNotMatch(h.element('movementFeedback').textContent, /left arm bend/);
});

test('delayed Māori-tagged voice is insufficient approval and never silently enables English fallback', () => {
    const h = harness();
    h.run("toggleVoiceMode(); selectVoiceLanguage('mi')");
    assert.equal(h.run('isVoiceMode'), false);
    assert.equal(h.element('voiceLanguageDialog').open, true);
    h.setVoices([{ name: 'Unreviewed Māori', lang: 'mi-NZ' }, { name: 'NZ English', lang: 'en-NZ' }]);
    h.speechSynthesis.onvoiceschanged();
    h.run("selectVoiceLanguage('mi')");
    assert.equal(h.run('isVoiceMode'), false);
    assert.equal(h.run('preferredMaoriVoice'), null);
    assert.match(h.element('maoriVoiceNotice').textContent, /awaits approval/);
    h.run("selectVoiceLanguage('en')");
    assert.equal(h.run('isVoiceMode'), true);
    assert.equal(h.spoken.at(-1).voice.name, 'NZ English');
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
    assert.deepEqual(h.element('gameTitleDisplay').children.map(child => child.lang), ['mi', 'en']);
    h.run("renderGameMetadata(document.getElementById('gameTitleDisplay'), { id: 2, name: 'Next source' }, 'name', 'Fallback'); PlayerLanguage.setPreview(true)");
    assert.equal(h.element('gameTitleDisplay').textContent, 'Next source');
});
