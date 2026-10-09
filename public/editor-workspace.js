(function () {
  'use strict';
  let nextId = 0;

  // Keep panels mounted so switching sections preserves drafts and live viewers.
  function tabs(root, sections, { label, initial, onSelect } = {}) {
    const id = `editor-tabs-${++nextId}`;
    const nav = document.createElement('div');
    nav.className = 'workspace-tabs';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', label);
    const buttons = sections.map(({ key, title, panel }, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = title;
      button.id = `${id}-tab-${key}`; panel.id = `${id}-panel-${key}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.tabIndex = 0;
      button.onclick = () => select(key);
      button.onkeydown = event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
        if (event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = sections.length - 1;
        if (next === undefined) return;
        event.preventDefault(); select(sections[next].key); buttons[next].focus();
      };
      nav.append(button); return button;
    });
    function select(key) {
      sections.forEach((section, index) => {
        const active = section.key === key;
        section.panel.hidden = !active;
        buttons[index].setAttribute('aria-selected', String(active));
        buttons[index].tabIndex = active ? 0 : -1;
      });
      onSelect?.(key);
    }
    root.prepend(nav);
    // Native form validation must reveal the field before the browser focuses it.
    let revealingInvalid = false;
    root.addEventListener('invalid', event => {
      if (revealingInvalid) return;
      revealingInvalid = true; queueMicrotask(() => { revealingInvalid = false; });
      const section = sections.find(({ panel }) => panel.contains(event.target));
      if (section) select(section.key);
      for (let node = event.target.parentElement; node && node !== root; node = node.parentElement) {
        if (node.tagName === 'DETAILS') node.open = true;
      }
    }, true);
    select(initial || sections[0].key);
    return { select };
  }

  function organizeForm(form, initial = 'details') {
    form.classList.add('owner-editor-form');
    const sections = [...form.querySelectorAll(':scope > [data-editor-section]')].map(panel => ({
      key: panel.dataset.editorSection, title: panel.dataset.editorTitle, panel
    }));
    tabs(form, sections, { label: 'Property editor sections', initial });
    const note = document.createElement('p');
    note.className = 'workspace-save-note';
    note.textContent = 'Save your changes before leaving the editor.';
    form.querySelector('.form-actions').prepend(note);
  }
  function progress(message) {
    const notice = document.createElement('div'); notice.className = 'toast action-progress';
    notice.textContent = message;
    document.querySelector('#toast-region').append(notice);
    return () => notice.remove();
  }
  function busy(button, message = 'Processing…') {
    const original = button.innerHTML, disabled = button.disabled;
    button.disabled = true; button.textContent = message;
    button.setAttribute('aria-busy', 'true');
    const finish = progress(message);
    return () => { button.innerHTML = original; button.disabled = disabled; button.removeAttribute('aria-busy'); finish(); };
  }
  const paint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  window.EditorWorkspace = { tabs, organizeForm, busy, progress, paint };
})();
