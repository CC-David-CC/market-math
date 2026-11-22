import {connectGameFiles} from '@webos/learning-game-core/workspace';
import {MarketMathSession} from './model.mjs';
import {computeLayout} from './layout.mjs';

function formatMoney(cents) {
  if (cents === null || cents === undefined) return '';
  if (typeof cents === 'object' && cents !== null && 'low' in cents && 'high' in cents) {
    return `$${(cents.low / 100).toFixed(2)} – $${(cents.high / 100).toFixed(2)}`;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

function createElement(host, tag, className, text) {
  if (host?.ui?.make) {
    return host.ui.make(tag, className, text);
  }
  if (typeof document !== 'undefined') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }
  return {
    tagName: tag.toUpperCase(),
    className: className || '',
    dataset: {},
    children: [],
    style: {},
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = kids ? [...kids] : []; },
    setAttribute() {},
    removeAttribute() {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {}
  };
}

export function mount(host, options = {}) {
  const root = createElement(host, 'div', 'window-content market-math-app');

  let session = new MarketMathSession(`market-${Date.now()}`);
  let disposed = false;
  let resizeObserver = null;

  // Header Bar
  const header = createElement(host, 'header', 'market-header');
  const titleGroup = createElement(host, 'div', 'market-title-group');
  const title = createElement(host, 'h1', 'market-title', '🏪 Market Math');
  titleGroup.append(title);

  const stats = createElement(host, 'div', 'market-stats');
  const progressBadge = createElement(host, 'span', 'market-badge market-progress');
  const scoreBadge = createElement(host, 'span', 'market-badge market-score');
  const starsBadge = createElement(host, 'span', 'market-badge market-stars');

  stats.append(progressBadge, scoreBadge, starsBadge);
  header.append(titleGroup, stats);

  // Main Container: Stalls Overview & Register Workbench
  const main = createElement(host, 'main', 'market-main');

  // Left: 12-Stall Overview
  const stallsSection = createElement(host, 'section', 'market-stalls-section');
  stallsSection.setAttribute?.('aria-label', 'Market Stalls');
  const stallGrid = createElement(host, 'div', 'market-stall-grid');
  stallsSection.append(stallGrid);

  // Right: Cash Register Workbench
  const workbench = createElement(host, 'section', 'market-workbench');
  workbench.setAttribute?.('aria-label', 'Cash Register Workbench');

  // Controls Footer
  const controls = createElement(host, 'footer', 'market-controls');
  const newMarketBtn = createElement(host, 'button', 'market-btn market-btn-outline', '🛒 Next Market');
  newMarketBtn.onclick = () => {
    session = new MarketMathSession(`market-${Date.now()}`);
    render();
  };
  controls.append(newMarketBtn);

  main.append(stallsSection, workbench);
  root.append(header, main, controls);

  function renderStalls() {
    stallGrid.replaceChildren();
    const state = session.state;
    state.stalls.forEach((s, idx) => {
      const stall = createElement(host, 'div', 'market-stall');
      if (idx === session.index) stall.classList?.add('active');
      if (s.solved) stall.classList?.add('solved');

      const stallNum = createElement(host, 'div', 'stall-num', `Stall ${idx + 1}`);
      const stallKind = createElement(host, 'div', 'stall-kind', s.kind);
      const stallStatus = createElement(host, 'div', 'stall-status', s.solved ? '✅ Balanced' : idx === session.index ? '💳 Serving' : '📦 Open');

      stall.append(stallNum, stallKind, stallStatus);
      stallGrid.append(stall);
    });
  }

  function renderWorkbench() {
    workbench.replaceChildren();
    progressBadge.textContent = `Stall ${Math.min(session.index + 1, 12)} / 12`;
    scoreBadge.textContent = `Score: ${session.score}`;
    starsBadge.textContent = `⭐ ${session.stars} stars`;

    if (session.phase === 'done') {
      const doneBox = createElement(host, 'div', 'market-card market-done');
      const heading = createElement(host, 'h2', '', '🎉 Market Day Complete!');
      const summary = createElement(host, 'p', '', `Outstanding accounting! You balanced all 12 registers with ${session.stars} stars and a score of ${session.score}.`);

      const restartBtn = createElement(host, 'button', 'market-btn market-btn-primary', 'Open Tomorrow\'s Market');
      restartBtn.onclick = () => {
        session = new MarketMathSession(`market-${Date.now()}`);
        render();
      };

      doneBox.append(heading, summary, restartBtn);
      workbench.append(doneBox);
      return;
    }

    if (session.phase === 'explain') {
      const explainCard = createElement(host, 'div', 'market-card market-explain');
      const heading = createElement(host, 'h2', '', '🧾 Receipt & Change Breakdown');
      const prompt = createElement(host, 'p', '', 'Review the exact decimal register math to proceed:');

      const continueBtn = createElement(host, 'button', 'market-btn market-btn-primary', 'Continue Serving Customers ▶');
      continueBtn.onclick = () => {
        session.continueAfterMiss();
        render();
      };

      explainCard.append(heading, prompt, continueBtn);
      workbench.append(explainCard);
      return;
    }

    const q = session.question;
    if (!q) return;

    const registerCard = createElement(host, 'div', 'market-card register-card');
    const registerTitle = createElement(host, 'h3', 'register-title', `Register Challenge: ${q.kind.toUpperCase()}`);
    const receiptBox = createElement(host, 'div', 'register-receipt');

    if (q.items && Array.isArray(q.items)) {
      const itemList = createElement(host, 'ul', 'receipt-item-list');
      q.items.forEach(item => {
        const li = createElement(host, 'li', 'receipt-item', `${item.name}: ${formatMoney(item.cents)}`);
        itemList.append(li);
      });
      receiptBox.append(itemList);
    }

    const promptText = createElement(host, 'p', 'register-prompt');
    if (q.kind === 'total') {
      promptText.textContent = 'Ring up the register total:';
    } else if (q.kind === 'change') {
      receiptBox.textContent = `Customer Total: ${formatMoney(q.total)}  |  Customer Paid: ${formatMoney(q.paid)}`;
      promptText.textContent = 'Calculate the exact change due:';
    } else if (q.kind === 'estimate') {
      promptText.textContent = 'Estimate the approximate dollar range:';
    } else if (q.kind === 'two-step') {
      const couponNotice = createElement(host, 'div', 'receipt-coupon', `Coupon Discount: -${formatMoney(q.coupon)}`);
      receiptBox.append(couponNotice);
      promptText.textContent = 'Compute final total after applying coupon:';
    }

    registerCard.append(registerTitle, receiptBox, promptText);

    // Answer choices
    const choicesGroup = createElement(host, 'div', 'register-choices');
    q.choices.forEach(choice => {
      const btn = createElement(host, 'button', 'market-choice-btn', formatMoney(choice));
      btn.onclick = () => {
        session.answer(choice);
        render();
      };
      choicesGroup.append(btn);
    });

    registerCard.append(choicesGroup);
    workbench.append(registerCard);
  }

  function render() {
    if (disposed) return;
    renderStalls();
    renderWorkbench();
  }

  const files = connectGameFiles(host, {
    header,
    id: 'market-math',
    title: 'Market Math',
    serialize: () => session.encodeSave(),
    restore(snapshot) {
      session = MarketMathSession.fromSave(snapshot);
      render();
    },
  });

  render();

  if (typeof ResizeObserver !== 'undefined' && root.getBoundingClientRect) {
    resizeObserver = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect;
      const layout = computeLayout(width, height);
      if (root.dataset) root.dataset.tier = layout.tier;
    });
    resizeObserver.observe(root);
  }

  return {
    element: root,
    get session() { return session; },
    ready: files.ready,
    requestClose: files.requestClose,
    dispose() {
      files.dispose?.();
      disposed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      root.replaceChildren?.();
    }
  };
}
