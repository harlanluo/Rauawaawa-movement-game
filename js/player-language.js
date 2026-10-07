/* Review metadata records wording quality; it does not gate player features. */
const PlayerLanguage = (() => {
    const resources = {};
    // Session preference: navigation/Retry/Next retain it; refresh defaults to English.
    let interfaceLanguage = 'en';
    const substitute = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
    function entry(key) { return resources[key] || { en: key, mi: '', status: 'missing', speechEn: key }; }
    function lines(key, values) {
        const resource = entry(key);
        return { en: substitute(resource.en || key, values), mi: substitute(resource.mi || '', values) };
    }
    function selected(key, values) {
        const text = lines(key, values);
        return interfaceLanguage === 'mi' && text.mi ? { lang: 'mi', text: text.mi } : { lang: 'en', text: text.en };
    }
    function isStaff(element) { return Boolean(element.closest('.staff-screen, .role-staff')); }
    function render(element, key, values) {
        if (!element || isStaff(element)) return;
        const label = selected(key, values);
        element.dataset.languageKey = key;
        element._languageValues = values;
        element.replaceChildren();
        const line = document.createElement('span');
        line.lang = label.lang;
        line.className = `language-${label.lang}`;
        line.textContent = label.text;
        element.appendChild(line);
        element.lang = label.lang;
        element.setAttribute('aria-label', label.text);
        element.setAttribute('title', label.text);
        // Spoken language is independent: callers use speech(key, voiceLanguage).
        if (element.matches('button')) element.dataset.speech = substitute(entry(key).speechEn || key, values);
    }
    function renderAccessibleLabel(element, key) {
        if (!element || isStaff(element)) return;
        const label = selected(key);
        element.lang = label.lang;
        element.setAttribute('aria-label', label.text);
        element.setAttribute('title', label.text);
    }
    function renderSwitch(element) {
        const language = interfaceLanguage === 'mi' ? 'Māori' : 'English';
        const nextLanguage = interfaceLanguage === 'mi' ? 'English' : 'Māori';
        const key = 'Interface language: {language}. Switch to {nextLanguage}.';
        element._languageValues = { language, nextLanguage };
        element.dataset.speechKey = key;
        element.dataset.selection = interfaceLanguage;
        element.replaceChildren();
        for (const [lang, text] of [['en', 'English'], ['', ' / '], ['mi', 'Māori']]) {
            const span = document.createElement('span');
            span.lang = lang;
            span.textContent = text;
            if (lang === interfaceLanguage) span.className = 'selected-language';
            element.appendChild(span);
        }
        const label = selected(key, element._languageValues);
        element.lang = label.lang;
        element.setAttribute('aria-label', label.text);
        element.setAttribute('title', label.text);
        element.setAttribute('aria-pressed', String(interfaceLanguage === 'mi'));
    }
    function setLanguage(language) {
        interfaceLanguage = language === 'mi' ? 'mi' : 'en';
        document.querySelectorAll('[data-language-key]').forEach(element =>
            render(element, element.dataset.languageKey, element._languageValues));
        document.querySelectorAll('[data-language-aria-label]').forEach(element =>
            renderAccessibleLabel(element, element.dataset.languageAriaLabel));
        document.querySelectorAll('[data-interface-language-switch]').forEach(renderSwitch);
    }
    function speech(key, language, values) {
        const resource = entry(key);
        if (language === 'mi' && !resource.speechMi && !resource.mi) return null;
        return substitute(language === 'mi' ? resource.speechMi || resource.mi : resource.speechEn || resource.en, values);
    }
    return { resources, entry, lines, selected, render,
        renderAccessibleLabel, renderSwitch, setLanguage, speech, get interfaceLanguage() { return interfaceLanguage; } };
})();
