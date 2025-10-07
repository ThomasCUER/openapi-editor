// openapi.js — loader / formatter / renderer for OpenAPI specs
window.addEventListener('DOMContentLoaded', () => {
  // we'll replace the textarea with a CodeMirror instance for better editing
  const textarea = document.getElementById('specEditor');
  const editor = CodeMirror.fromTextArea(textarea, {
    mode: 'yaml',
    lineNumbers: true,
    matchBrackets: true,
    tabSize: 2,
    indentUnit: 2,
    autofocus: false,
    foldGutter: true,
    gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
  });
  const loadSample = document.getElementById('loadSample');
  const fileInput = document.getElementById('fileInput');
  const formatBtn = document.getElementById('formatBtn');
  const foldAllBtn = document.getElementById('foldAllBtn');
  const unfoldAllBtn = document.getElementById('unfoldAllBtn');
  // renderBtn removed - rendering is automatic
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const msg = document.getElementById('msg');
  const specRender = document.getElementById('specRender');

  function showMsg(s) {
    msg.textContent = s;
    setTimeout(() => { if (msg.textContent === s) msg.textContent = ''; }, 3000);
  }

  // Load sample from external file `sample-openapi.yaml` (no embedded fallback)
  loadSample.addEventListener('click', async () => {
    try {
      const resp = await fetch('sample-openapi.yaml');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const t = await resp.text();
      editor.setValue(t);
      showMsg('Exemple chargé (fetch)');
      debouncedRender();
    } catch (e) {
      console.error('Failed to load sample-openapi.yaml:', e);
      showMsg('Erreur chargement exemple: ' + (e && e.message ? e.message : String(e)));
    }
  });

  // Load a local file from user's disk
  if (fileInput) {
    fileInput.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => { editor.setValue(String(reader.result)); showMsg('Fichier chargé'); debouncedRender(); };
        reader.onerror = () => showMsg('Erreur lecture fichier');
        reader.readAsText(f);
    });
  }

    clearBtn.addEventListener('click', () => { editor.setValue(''); specRender.innerHTML = ''; showMsg('Éditeur vidé'); });

  saveBtn.addEventListener('click', () => {
      localStorage.setItem('openapi-spec', editor.getValue());
    showMsg('Spécification sauvegardée localement');
  });

  formatBtn.addEventListener('click', () => {
    const v = editor.getValue().trim();
    if (!v) { showMsg('Éditeur vide'); return; }
    try {
      let obj;
      try { obj = JSON.parse(v); }
      catch (e) { obj = jsyaml.load(v); }
      const yaml = jsyaml.dump(obj, { noRefs: true, sortKeys: false });
      editor.setValue(yaml);
      showMsg('Formaté en YAML');
    } catch (err) {
      showMsg('Erreur parsing: ' + err.message);
    }
  });

  // Factor rendering logic so it can be called from multiple places
  function renderSpecObject(obj) {
    const renderer = document.querySelector('input[name="renderer"]:checked')?.value || 'redoc';
    specRender.innerHTML = '';

    if (renderer === 'redoc') {
      const redocDiv = document.createElement('div');
      redocDiv.id = 'redoc';
      specRender.appendChild(redocDiv);
      try {
        Redoc.init(obj, {}, redocDiv).then(() => showMsg('Rendu terminé (Redoc)')).catch(err => { console.error('Redoc failed:', err); showMsg('Redoc erreur: ' + (err && err.message ? err.message : String(err))); });
      } catch (err) { console.error('Redoc init threw:', err); showMsg('Redoc init erreur: ' + (err && err.message ? err.message : String(err))); }
    } else {
      const swaggerDiv = document.createElement('div');
      swaggerDiv.id = 'swagger';
      specRender.appendChild(swaggerDiv);
      try {
        const ui = SwaggerUIBundle({ spec: obj, dom_id: '#swagger', presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset], });
        showMsg('Rendu terminé (Swagger UI)');
      } catch (err) { console.error('Swagger UI failed:', err); showMsg('Swagger UI erreur: ' + (err && err.message ? err.message : String(err))); }
    }
  }

  function tryParseAndRender() {
    const v = editor.getValue().trim();
    if (!v) { specRender.innerHTML = ''; showMsg('Éditeur vide'); return; }
    let obj;
    try { obj = JSON.parse(v); } catch (e) { try { obj = jsyaml.load(v); } catch (e2) { showMsg('Parsing erreur: ' + e2.message); return; } }
    renderSpecObject(obj);
  }

  // debounce helper
  function debounce(fn, wait) {
    let t = null;
    return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
  }

  const debouncedRender = debounce(tryParseAndRender, 450);

  // manual render button removed; rendering happens automatically via editor change / load / renderer change

  const saved = localStorage.getItem('openapi-spec');
  if (saved) { editor.setValue(saved); showMsg('Spécification chargée depuis localStorage'); }
  // auto-render when editor content changes
  editor.on('change', () => debouncedRender());

  // auto-render when renderer selection changes
  document.querySelectorAll('input[name="renderer"]').forEach(r => r.addEventListener('change', (e) => { localStorage.setItem('openapi-renderer', e.target.value); debouncedRender(); }));

  // restore renderer choice from localStorage
  const savedRenderer = localStorage.getItem('openapi-renderer');
  if (savedRenderer) {
    const radio = document.querySelector('input[name="renderer"][value="' + savedRenderer + '"]');
    if (radio) radio.checked = true;
  }

  // initial render if there's content
  if (editor.getValue().trim()) debouncedRender();

  // fold/unfold utilities
  function foldAll() {
    const lastLine = editor.lastLine();
    for (let i = 0; i <= lastLine; i++) {
      editor.foldCode({line: i, ch: 0}, null, "fold");
    }
  }
  function unfoldAll() {
    const lastLine = editor.lastLine();
    for (let i = 0; i <= lastLine; i++) {
      editor.foldCode({line: i, ch: 0}, null, "unfold");
    }
  }

  if (foldAllBtn) foldAllBtn.addEventListener('click', () => foldAll());
  if (unfoldAllBtn) unfoldAllBtn.addEventListener('click', () => unfoldAll());
  
  // Resizable splitter logic
  const splitter = document.querySelector('.splitter');
  const left = document.querySelector('.editor-panel');
  const right = document.querySelector('.render-panel');
  let isDragging = false;
  let startX = 0;
  let startLeftWidth = 0;

  function refreshEditor() { try { editor.refresh(); } catch (e) { /* ignore */ } }

  if (splitter) {
    splitter.addEventListener('mousedown', (e) => {
      isDragging = true; startX = e.clientX; startLeftWidth = left.getBoundingClientRect().width; document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const newLeft = startLeftWidth + dx;
      const containerWidth = left.parentElement.getBoundingClientRect().width;
      const min = 150; const max = containerWidth - 150;
      if (newLeft < min || newLeft > max) return;
      left.style.flex = '0 0 ' + newLeft + 'px';
      refreshEditor();
    });
    window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; document.body.style.userSelect = ''; } });

    // touch support
    splitter.addEventListener('touchstart', (e) => { isDragging = true; startX = e.touches[0].clientX; startLeftWidth = left.getBoundingClientRect().width; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!isDragging) return; const dx = e.touches[0].clientX - startX; const newLeft = startLeftWidth + dx; const containerWidth = left.parentElement.getBoundingClientRect().width; const min = 120; const max = containerWidth - 120; if (newLeft < min || newLeft > max) return; left.style.flex = '0 0 ' + newLeft + 'px'; refreshEditor();
    }, { passive: true });
    window.addEventListener('touchend', () => { isDragging = false; });

    // double-click to reset
    splitter.addEventListener('dblclick', () => { left.style.flex = '0 0 45%'; refreshEditor(); });
  }
});
