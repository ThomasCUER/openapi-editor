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
    // run rules checks
    try { renderRules(obj); } catch (e) { console.error('rules failed', e); }
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

  // Rules panel: detect unused schemas
  const rulesPanel = document.getElementById('rulesPanel');
  const toggleRules = document.getElementById('toggleRules');

  function findRefs(obj, refs = new Set()) {
    if (Array.isArray(obj)) {
      obj.forEach(v => findRefs(v, refs));
    } else if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (k === '$ref' && typeof v === 'string') {
          refs.add(v);
        } else {
          findRefs(v, refs);
        }
      }
    }
    return refs;
  }

  function checkUnusedSchemas(specObj) {
    const schemas = specObj.components && specObj.components.schemas ? Object.keys(specObj.components.schemas) : [];
    const refs = Array.from(findRefs(specObj)).map(r => r.replace(/^#\/(components|definitions)\/(schemas)\//, '').replace(/^#\/(components|definitions)\//, ''));
    // refs can be '#/components/schemas/MySchema' or '#/definitions/MySchema'
    const used = new Set(refs.map(r => {
      const parts = r.split('/'); return parts[parts.length-1];
    }));
    const unused = schemas.filter(s => !used.has(s));
    return unused;
  }

  // Find integer properties without min/max in components.schemas
  function checkIntegerBounds(specObj) {
    const results = [];
    const schemas = specObj.components && specObj.components.schemas ? specObj.components.schemas : {};

    function inspectSchema(schema, schemaName, path = []) {
      if (!schema || typeof schema !== 'object') return;

      // If this schema directly declares properties
      if (schema.properties && typeof schema.properties === 'object') {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const currentPath = path.concat(propName);
          // resolve simple $ref skip
          if (propSchema && propSchema.$ref) {
            // skip referenced props (could resolve later)
            continue;
          }
          const t = propSchema && propSchema.type;
          const isInteger = t === 'integer' || (Array.isArray(t) && t.indexOf('integer') !== -1);
          if (isInteger) {
            const hasMin = ('minimum' in propSchema) || ('exclusiveMinimum' in propSchema);
            const hasMax = ('maximum' in propSchema) || ('exclusiveMaximum' in propSchema);
            if (!hasMin && !hasMax) {
              results.push({ type: 'integer-bounds', schema: schemaName, propPath: currentPath.slice(), propName });
            }
          }
          // If nested properties
          if (propSchema && propSchema.properties) {
            inspectSchema(propSchema, schemaName, currentPath);
          }
          // arrays: inspect items
          if (propSchema && propSchema.type === 'array' && propSchema.items) {
            const items = propSchema.items;
            if (items && !items.$ref) {
              // if items are integer
              const it = items.type;
              const isIntItem = it === 'integer' || (Array.isArray(it) && it.indexOf('integer') !== -1);
              if (isIntItem) {
                const hasMin = ('minimum' in items) || ('exclusiveMinimum' in items);
                const hasMax = ('maximum' in items) || ('exclusiveMaximum' in items);
                if (!hasMin && !hasMax) {
                  results.push({ type: 'integer-bounds', schema: schemaName, propPath: currentPath.slice().concat('[].items'), propName });
                }
              }
              if (items.properties) inspectSchema(items, schemaName, currentPath.concat('[].items'));
            }
          }
        }
      }

      // handle allOf / anyOf / oneOf - inspect each subschema
      ['allOf','anyOf','oneOf'].forEach(key => {
        if (Array.isArray(schema[key])) schema[key].forEach(s => inspectSchema(s, schemaName, path));
      });
    }

    for (const [schemaName, schemaObj] of Object.entries(schemas)) {
      inspectSchema(schemaObj, schemaName, []);
    }
    return results;
  }

  function renderRules(specObj) {
    if (!rulesPanel) return;
    try {
      // collect both unused schemas and integer-bounds warnings
      const unused = checkUnusedSchemas(specObj);
      const intWarnings = checkIntegerBounds(specObj);
      if (!unused.length && !intWarnings.length) { rulesPanel.innerHTML = '<div>Aucun warning détecté.</div>'; return; }
      rulesPanel.innerHTML = '';

      // render unused schema warnings first
      unused.forEach(name => {
        const div = document.createElement('div'); div.className = 'rule-item';
        const left = document.createElement('div');
        const badge = document.createElement('span'); badge.className = 'rule-badge'; badge.textContent = 'schéma non utilisé';
        const nm = document.createElement('span'); nm.textContent = name;
        left.appendChild(badge); left.appendChild(nm);
        const right = document.createElement('div');
        const btn = document.createElement('button'); btn.className = 'rule-action'; btn.textContent = 'Aller à la définition';
        btn.addEventListener('click', () => { // reuse existing go-to logic
          const content = editor.getValue();
          const esc = name.replace(/[-\/\\^$*+?.()|[\\]{}]/g, '\\$&');
          const patterns = [new RegExp('^\\s*' + esc + '\\s*:', 'm'), new RegExp('^\\s*["\']' + esc + '["\']\\s*:', 'm'), new RegExp('"' + esc + '"\\s*:\\s*\\{', 'm'), new RegExp('\\b' + esc + '\\b', 'm')];
          let foundIndex = -1; for (const p of patterns) { const m = p.exec(content); if (m) { foundIndex = m.index; break; } }
          if (foundIndex >= 0) { const pos = content.slice(0, foundIndex).split(/\r?\n/).length - 1; editor.focus(); editor.setCursor({line: pos, ch: 0}); editor.scrollIntoView({line: pos, ch: 0}, 100); return; }
          const compPos = content.indexOf('components'); if (compPos !== -1) { const schemasPos = content.indexOf('schemas', compPos); if (schemasPos !== -1) { const namePos = content.indexOf(name, schemasPos); if (namePos !== -1) { const pos = content.slice(0, namePos).split(/\r?\n/).length - 1; editor.focus(); editor.setCursor({line: pos, ch: 0}); editor.scrollIntoView({line: pos, ch: 0}, 100); return; } } }
          alert('Définition introuvable dans le document (recherches YAML/JSON effectuées)');
        });
        right.appendChild(btn);
        div.appendChild(left); div.appendChild(right); rulesPanel.appendChild(div);
      });

      // render integer bounds warnings
      intWarnings.forEach(w => {
        const div = document.createElement('div'); div.className = 'rule-item';
        const left = document.createElement('div');
        const badge = document.createElement('span'); badge.className = 'rule-badge int'; badge.textContent = 'entier sans min/max';
        const nm = document.createElement('span'); nm.textContent = w.schema + '.' + w.propPath.join('.');
        left.appendChild(badge); left.appendChild(nm);
        const right = document.createElement('div');
        const btn = document.createElement('button'); btn.className = 'rule-action'; btn.textContent = 'Aller à la définition';
        btn.addEventListener('click', () => {
          // try to find property within schema block
          const content = editor.getValue();
          const schemaName = w.schema;
          const propName = w.propPath[w.propPath.length-1];
          const escSchema = schemaName.replace(/[-\/\\^$*+?.()|[\\]{}]/g, '\\$&');
          const schemaPattern = new RegExp('^\\s*' + escSchema + '\\s*:', 'm');
          const mSchema = schemaPattern.exec(content);
          if (mSchema) {
            const startIdx = mSchema.index;
            // search propName after startIdx
            const propIdx = content.indexOf(propName, startIdx);
            if (propIdx !== -1) {
              const pos = content.slice(0, propIdx).split(/\r?\n/).length - 1;
              editor.focus(); editor.setCursor({line: pos, ch: 0}); editor.scrollIntoView({line: pos, ch: 0}, 100);
              return;
            }
          }
          // fallback: simple search
          const pc = content.indexOf(propName);
          if (pc !== -1) { const pos = content.slice(0, pc).split(/\r?\n/).length - 1; editor.focus(); editor.setCursor({line: pos, ch: 0}); editor.scrollIntoView({line: pos, ch: 0}, 100); return; }
          alert('Définition introuvable pour ' + w.schema + '.' + propName);
        });
        right.appendChild(btn);
        div.appendChild(left); div.appendChild(right); rulesPanel.appendChild(div);
      });
    } catch (e) { rulesPanel.innerHTML = '<div>Erreur dans l analyse des règles: ' + e.message + '</div>'; }
  }

  if (toggleRules) toggleRules.addEventListener('click', () => {
    const panel = document.getElementById('rulesPanel'); if (!panel) return; if (panel.style.display === 'none') { panel.style.display = ''; toggleRules.textContent = 'Masquer'; } else { panel.style.display = 'none'; toggleRules.textContent = 'Afficher'; }
  });
  
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
