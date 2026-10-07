/* Written wording and voice delivery require separate Rauawaawa approval. */
const PlayerLanguage = (() => {
    const resources = {};
    let preview = new URLSearchParams(location.search).get('draftLanguage') === '1';
    const substitute = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);

    function entry(key) { return resources[key] || { en: key, mi: '', status: 'missing', speechEn: key }; }
    function lines(key, values) {
        const resource = entry(key);
        return { en: substitute(resource.en, values), mi: (preview || resource.status === 'approved')
            ? substitute(resource.mi, values) : '' };
    }
    function render(element, key, values) {
        if (!element) return;
        const text = lines(key, values);
        element.dataset.languageKey = key;
        element._languageValues = values;
        element.replaceChildren();
        for (const [lang, value] of [['mi', text.mi], ['en', text.en]]) {
            if (!value) continue;
            const line = document.createElement('span');
            line.lang = lang;
            line.className = `language-${lang}`;
            line.textContent = value;
            if (lang === 'mi' && element.getAttribute('aria-live')) line.setAttribute('aria-hidden', 'true');
            element.appendChild(line);
        }
        // Frequent feedback announces English once, while both written lines remain visible.
        element.setAttribute('aria-label', text.en);
        if (element.matches('button')) element.dataset.speech = substitute(entry(key).speechEn || key, values);
    }
    function setPreview(enabled) {
        preview = enabled;
        document.querySelectorAll('[data-language-key]').forEach(element =>
            render(element, element.dataset.languageKey, element._languageValues));
    }
    function speech(key, language, values) {
        const resource = entry(key);
        // Unreviewed scripts cannot be delivered as approved Māori guidance.
        if (language === 'mi' && (resource.status !== 'approved' || resource.speechStatus !== 'approved')) return null;
        return substitute(language === 'mi' ? resource.speechMi || resource.mi : resource.speechEn || resource.en, values);
    }
    return { resources, voiceResources: { mi: { approvedVoiceNames: [] } }, entry, lines, render, setPreview, speech, get preview() { return preview; } };
})();
