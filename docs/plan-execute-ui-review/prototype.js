(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const toast = (text) => {
    const el = $("#toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  };
  const openModal = (kind) => {
    const modal = $("#confirm-modal");
    if (!modal) return;
    const closing = kind === "close";
    $("#modal-title").textContent = closing ? "关闭 Plan-and-Execute 模式？" : "取消当前计划？";
    $("#modal-copy").textContent = closing
      ? "未完成步骤将停止，当前会话切回普通对话。计划和已完成结果会保留为只读历史。"
      : "正在执行的步骤将收到中止请求，未完成步骤会标记为已取消。会话之后仍可创建新计划。";
    $("#modal-confirm").textContent = closing ? "关闭模式" : "取消计划";
    $("#modal-confirm").dataset.kind = kind;
    modal.classList.add("show");
  };
  const closeModal = () => $("#confirm-modal")?.classList.remove("show");

  $$("[data-toggle-drawer]").forEach((button) => button.addEventListener("click", () => {
    const panel = $("#plan-drawer");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    button.textContent = panel.hidden ? "展开" : "收起";
  }));
  $$("[data-open-rail]").forEach((button) => button.addEventListener("click", () => $("#task-rail")?.classList.add("open")));
  $$("[data-close-rail]").forEach((button) => button.addEventListener("click", () => $("#task-rail")?.classList.remove("open")));
  $$("[data-pause]").forEach((button) => button.addEventListener("click", () => {
    const root = $("[data-plan-root]");
    const paused = root?.classList.toggle("paused") ?? false;
    $$('[data-pause]').forEach((b) => { b.textContent = paused ? "继续" : "暂停"; });
    toast(paused ? "计划已暂停，不再调度新步骤" : "计划已继续执行");
  }));
  $$("[data-confirm]").forEach((button) => button.addEventListener("click", () => openModal(button.dataset.confirm)));
  $$("[data-modal-close]").forEach((button) => button.addEventListener("click", closeModal));
  $("#modal-confirm")?.addEventListener("click", (event) => {
    const kind = event.currentTarget.dataset.kind;
    closeModal();
    toast(kind === "close" ? "已关闭计划模式，会话切回普通对话" : "已请求取消当前计划");
  });
  $("#confirm-modal")?.addEventListener("click", (event) => { if (event.target.id === "confirm-modal") closeModal(); });

  $$("[data-menu]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = $("#step-menu");
    if (!menu) return;
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left - 130, window.innerWidth - 174)}px`;
    menu.style.top = `${Math.min(rect.bottom + 3, window.innerHeight - 190)}px`;
    menu.classList.toggle("show");
  }));
  document.addEventListener("click", () => $("#step-menu")?.classList.remove("show"));
  $$("#step-menu button").forEach((button) => button.addEventListener("click", () => {
    $("#step-menu")?.classList.remove("show");
    if (button.dataset.action === "skip") toast("步骤已跳过，将检查下游依赖");
    else if (button.dataset.action === "retry") toast("失败步骤已加入重试队列");
    else toast("正在为该步骤重新规划");
  }));

  $$("[data-plan-anchor]").forEach((button) => button.addEventListener("click", () => {
    $("#plan-ledger")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("#plan-ledger")?.animate([{outline:"3px solid rgba(22,134,168,.25)"},{outline:"0 solid transparent"}],{duration:900});
  }));

  $$('[data-send-command]').forEach((button) => button.addEventListener('click', () => {
    const input = $('#composer-input');
    const feedback = $('#intent-feedback');
    const text = input?.value.trim() || button.dataset.example || '';
    if (!text) return;

    if (feedback && /测试/.test(text) && /(手动|执行|跑过)/.test(text) && /(通过|完成)/.test(text)) {
      feedback.innerHTML = '正在处理你的更新，不会启动新的任务步骤…';
      feedback.classList.add('show');
      window.setTimeout(() => {
        const status = $('#manual-test-status');
        const detail = $('#manual-test-detail');
        status?.classList.add('done');
        if (status) status.textContent = '✓';
        if (detail) detail.textContent = '由用户手动完成 · 全部通过';
        feedback.innerHTML = '✓ 已根据你的消息完成“运行完整测试”，任务列表已更新';
        toast('任务列表 revision 已更新为 r4');
      }, 550);
    } else if (feedback) {
      feedback.innerHTML = `正在优先处理你的消息：<strong>${text}</strong>`;
      feedback.classList.add('show');
    }
    if (input) input.value = '';
  }));

  $("#composer-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("[data-send-command]")?.click();
    }
  });
})();
