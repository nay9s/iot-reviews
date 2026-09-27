/**
 * IoT Exam Review Web Application
 * State Management, Routing, Quiz Engine, Shuffle, Light/Dark Theme
 */

(function () {
  'use strict';

  // State object
  // Helper: Preferences
  function loadSavedPreferences() {
    try {
      const saved = localStorage.getItem('iot_quiz_prefs');
      if (saved) {
        return Object.assign({
          shuffleQuestions: true,
          shuffleChoices: true,
          feedbackMode: 'instant',
          examQuestionCount: 150
        }, JSON.parse(saved));
      }
    } catch (e) {}
    return {
      shuffleQuestions: true,
      shuffleChoices: true,
      feedbackMode: 'instant',
      examQuestionCount: 150
    };
  }

  function saveQuizPreferences(prefs) {
    try {
      localStorage.setItem('iot_quiz_prefs', JSON.stringify(prefs));
    } catch (e) {}
  }

  // Helper: Exam History
  function getExamHistory() {
    try {
      const raw = localStorage.getItem('iot_exam_history');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to get history', e);
      return [];
    }
  }

  function saveExamResult(record) {
    try {
      const history = getExamHistory();
      history.unshift(record);
      if (history.length > 50) history.pop();
      localStorage.setItem('iot_exam_history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to save exam history', e);
    }
  }

  function deleteExamResult(id) {
    try {
      let history = getExamHistory();
      history = history.filter(item => item.id !== id);
      localStorage.setItem('iot_exam_history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to delete history', e);
    }
  }

  function clearAllExamHistory() {
    try {
      localStorage.removeItem('iot_exam_history');
    } catch (e) {
      console.error('Failed to clear history', e);
    }
  }

  function getExamStats() {
    const history = getExamHistory();
    if (history.length === 0) {
      return { totalAttempts: 0, avgScore: 0, maxScore: 0, totalQuestions: 0 };
    }
    const totalAttempts = history.length;
    const totalScorePercent = history.reduce((sum, h) => sum + (h.percent || 0), 0);
    const avgScore = Math.round(totalScorePercent / totalAttempts);
    const maxScore = Math.max(...history.map(h => h.percent || 0));
    const totalQuestions = history.reduce((sum, h) => sum + (h.total || 0), 0);
    return { totalAttempts, avgScore, maxScore, totalQuestions };
  }

  // State object
  const state = {
    theme: localStorage.getItem('iot_exam_theme') || 'light',
    currentRoute: 'home',
    routeParams: {},
    settings: loadSavedPreferences(),
    quiz: {
      active: false,
      title: '',
      subtitle: '',
      chapterId: null, // null for 'all'
      questions: [],   // prepared questions for current session
      currentIndex: 0,
      userAnswers: {}, // index -> chosen option index
      flagged: {},     // index -> boolean
      timerSeconds: 0,
      timerInterval: null,
      submitted: false,
      results: null,
      mode: 'instant'
    },
    reviewFilter: 'all' // 'all', 'wrong', 'correct', 'flagged'
  };

  // Helper: Shuffle Array (Fisher-Yates)
  function shuffleArray(arr) {
    const array = [...arr];
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Helper: Format Time mm:ss
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // Initialize Theme
  function initTheme() {
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get('theme');
    if (themeParam === 'dark' || themeParam === 'light') {
      state.theme = themeParam;
    }
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();
  }

  function setTheme(newTheme) {
    state.theme = newTheme;
    localStorage.setItem('iot_exam_theme', state.theme);
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();
  }

  function toggleTheme() {
    setTheme(state.theme === 'light' ? 'dark' : 'light');
  }

  function updateThemeIcon() {
    const btn = document.getElementById('themeToggleBtn');
    if (btn && window.getIcon) {
      btn.innerHTML = state.theme === 'light' ? window.getIcon('moon') : window.getIcon('sun');
      btn.setAttribute('title', state.theme === 'light' ? 'เปลี่ยนเป็น Dark Mode' : 'เปลี่ยนเป็น Light Mode');
    }
  }

  // Routing Management
  function navigateTo(hash) {
    window.location.hash = hash;
  }

  function handleRoute() {
    const hash = window.location.hash.slice(1) || 'home';
    const parts = hash.split('/');
    const mainRoute = parts[0];
    const param = parts[1] || null;

    state.currentRoute = mainRoute;
    state.routeParams = { id: param };

    // Update active nav link (both Desktop and Mobile Bottom Nav)
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => {
      const target = el.getAttribute('data-nav');
      if (target === mainRoute || 
          (mainRoute.startsWith('chapter') && target === 'chapters') || 
          ((mainRoute === 'quiz' || mainRoute === 'quiz-hub' || mainRoute === 'result') && target === 'quiz-hub') ||
          (mainRoute === 'settings' && target === 'settings')) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    closeMobileDrawer();

    const appRoot = document.getElementById('app-root');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (mainRoute === 'home') {
      renderHome(appRoot);
    } else if (mainRoute === 'chapters') {
      renderChaptersList(appRoot);
    } else if (mainRoute === 'chapter' && param) {
      renderChapterDetail(appRoot, parseInt(param, 10));
    } else if (mainRoute === 'quiz-hub') {
      renderQuizHub(appRoot);
    } else if (mainRoute === 'quiz') {
      if (param && param.startsWith('chapter-')) {
        const cid = parseInt(param.replace('chapter-', ''), 10);
        startQuizSession(cid);
      } else if (param === 'all') {
        startQuizSession(null);
      } else if (state.quiz.active && state.quiz.questions.length > 0) {
        renderQuizActive(appRoot);
      } else {
        renderQuizHub(appRoot);
      }
    } else if (mainRoute === 'result') {
      renderQuizResult(appRoot);
    } else if (mainRoute === 'settings') {
      renderSettings(appRoot);
    } else {
      renderHome(appRoot);
    }
  }

  // Render: Home Page
  function renderHome(container) {
    const chapters = window.CHAPTERS_DATA || [];
    const totalQuestions = (window.QUESTIONS_DATA || []).length;

    let html = `
      <section class="hero-card">
        <div class="hero-tag">
          ${window.getIcon('award', 'icon-sm')} ระบบทบทวนข้อสอบวิชา IoT
        </div>
        <h1 class="hero-title">คลังสรุปเนื้อหาและแนวข้อสอบ Internet of Things</h1>
        <p class="hero-subtitle">
          เตรียมความพร้อมสอบอย่างมั่นใจ ครอบคลุม 5 บทเรียนสำคัญตามแนวข้อสอบจริง สรุปเนื้อหาเน้นความเข้าใจ
          และแบบทดสอบ 150 ข้อพร้อมเฉลยละเอียดและวิเคราะห์ตัวเลือก
        </p>
        
        <div class="action-banner">
          <div class="banner-content">
            <h3>พร้อมทดสอบความรู้ครบทุกบทหรือยัง?</h3>
            <p>ทำแบบทดสอบรวม 150 ข้อ สุ่มโจทย์ สุ่มตัวเลือก และเลือกตรวจคำตอบได้ทันที</p>
          </div>
          <button class="btn btn-primary" id="btnStartAllQuizHero">
            ${window.getIcon('play')} เริ่มทำแบบทดสอบรวมทุกบท
          </button>
        </div>

        <div class="hero-stats">
          <div class="stat-item">
            <div class="stat-icon">${window.getIcon('book-open')}</div>
            <div>
              <div class="stat-value">5 บท</div>
              <div class="stat-label">สรุปเนื้อหาเข้มข้น</div>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-icon">${window.getIcon('help-circle')}</div>
            <div>
              <div class="stat-value">${totalQuestions} ข้อ</div>
              <div class="stat-label">ข้อสอบพร้อมเฉลยละเอียด</div>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-icon">${window.getIcon('shuffle')}</div>
            <div>
              <div class="stat-value">2 โหมด</div>
              <div class="stat-label">เฉลยทันที / สอบวัดผล</div>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-icon">${window.getIcon('award')}</div>
            <div>
              <div class="stat-value">100%</div>
              <div class="stat-label">ตรงตามแนวข้อสอบ</div>
            </div>
          </div>
        </div>
      </section>

      <section class="section-header">
        <h2>${window.getIcon('book-open')} สรุปเนื้อหาและแบบทดสอบรายบท</h2>
        <a href="#chapters" class="btn btn-sm btn-secondary">ดูทั้งหมด (${chapters.length} บท)</a>
      </section>

      <div class="chapter-grid">
    `;

    chapters.forEach(ch => {
      html += `
        <div class="chapter-card">
          <div class="chapter-card-top">
            <div class="chapter-badge-wrap">
              <span class="chapter-pill">บทที่ ${ch.id}</span>
              <div class="chapter-icon-circle">${window.getIcon(ch.icon)}</div>
            </div>
            <h3 class="chapter-title">${ch.title}</h3>
            <div class="chapter-eng-title">${ch.englishTitle}</div>
            <p class="chapter-desc">${ch.description}</p>
          </div>
          <div class="chapter-card-actions">
            <a href="#chapter/${ch.id}" class="btn btn-sm btn-secondary">
              ${window.getIcon('book-open')} อ่านสรุปบทนี้
            </a>
            <button class="btn btn-sm btn-outline-primary btn-start-chapter-quiz" data-chapter="${ch.id}">
              ${window.getIcon('play')} ทำข้อสอบ (30 ข้อ)
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    // Attach listeners
    document.getElementById('btnStartAllQuizHero')?.addEventListener('click', () => {
      openQuizSettingsModal(null);
    });

    document.querySelectorAll('.btn-start-chapter-quiz').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cid = parseInt(e.currentTarget.getAttribute('data-chapter'), 10);
        openQuizSettingsModal(cid);
      });
    });
  }

  // Render: Chapters List
  function renderChaptersList(container) {
    const chapters = window.CHAPTERS_DATA || [];
    let html = `
      <div class="breadcrumb">
        <a href="#home">${window.getIcon('home')} หน้าหลัก</a>
        <span>/</span>
        <span>สรุปเนื้อหา 5 บท</span>
      </div>

      <div class="section-header" style="margin-bottom: 24px;">
        <div>
          <h2>${window.getIcon('book-open')} รายการสรุปเนื้อหาตามแนวข้อสอบ</h2>
          <p style="color: var(--text-secondary); margin-top: 4px; font-size: 15px;">
            เลือกอ่านสรุปเนื้อหาแต่ละบทเพื่อทบทวนทฤษฎี ตารางเปรียบเทียบ และจุดสำคัญที่มักออกสอบ
          </p>
        </div>
      </div>

      <div class="chapter-grid">
    `;

    chapters.forEach(ch => {
      html += `
        <div class="chapter-card">
          <div class="chapter-card-top">
            <div class="chapter-badge-wrap">
              <span class="chapter-pill">บทที่ ${ch.id}</span>
              <div class="chapter-icon-circle">${window.getIcon(ch.icon)}</div>
            </div>
            <h3 class="chapter-title">${ch.title}</h3>
            <div class="chapter-eng-title">${ch.englishTitle}</div>
            <p class="chapter-desc">${ch.description}</p>
          </div>
          <div class="chapter-card-actions">
            <a href="#chapter/${ch.id}" class="btn btn-sm btn-primary">
              ${window.getIcon('book-open')} อ่านสรุปละเอียด
            </a>
            <button class="btn btn-sm btn-secondary btn-start-chapter-quiz" data-chapter="${ch.id}">
              ${window.getIcon('play')} ข้อสอบ 30 ข้อ
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    document.querySelectorAll('.btn-start-chapter-quiz').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cid = parseInt(e.currentTarget.getAttribute('data-chapter'), 10);
        openQuizSettingsModal(cid);
      });
    });
  }

  // Render: Chapter Detail View
  function renderChapterDetail(container, chapterId) {
    const chapter = (window.CHAPTERS_DATA || []).find(c => c.id === chapterId);
    if (!chapter) {
      container.innerHTML = `<div class="hero-card"><h2>ไม่พบบทเรียนที่ระบุ</h2><a href="#chapters" class="btn btn-primary">กลับหน้ารวมบท</a></div>`;
      return;
    }

    let html = `
      <div class="breadcrumb">
        <a href="#home">${window.getIcon('home')} หน้าหลัก</a>
        <span>/</span>
        <a href="#chapters">สรุปเนื้อหา</a>
        <span>/</span>
        <span>บทที่ ${chapter.id}</span>
      </div>

      <div class="chapter-detail-hero">
        <div class="chapter-badge-wrap">
          <span class="chapter-pill">บทที่ ${chapter.id}</span>
          <div class="chapter-icon-circle">${window.getIcon(chapter.icon)}</div>
        </div>
        <h1 style="font-size: 26px; margin-bottom: 8px;">${chapter.title}</h1>
        <div style="color: var(--text-muted); font-size: 15px; margin-bottom: 14px;">${chapter.englishTitle}</div>
        <p style="color: var(--text-secondary); font-size: 16px; line-height: 1.7;">${chapter.description}</p>

        <div class="focus-box">
          ${window.getIcon('info')}
          <div>
            <strong>จุดเน้นสำหรับข้อสอบบทนี้:</strong> ${chapter.examFocus}
          </div>
        </div>
      </div>
    `;

    // Sections
    chapter.sections.forEach(sec => {
      html += `
        <div class="section-card">
          <h3 class="section-card-title">
            ${sec.title}
          </h3>
          <div class="section-text">${formatMarkdownSimple(sec.content)}</div>
      `;

      // If section has a comparison table
      if (sec.comparison) {
        html += `
          <div class="table-responsive">
            <table class="minimal-table">
              <thead>
                <tr>
                  ${sec.comparison.headers.map(h => `<th>${h}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${sec.comparison.rows.map(row => `
                  <tr>
                    ${row.map(cell => `<td>${cell}</td>`).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      // Key Takeaway Box
      if (sec.keyTakeaway) {
        html += `
          <div class="key-takeaway-box">
            ${window.getIcon('award')}
            <div>
              <strong>ประเด็นจำแม่น:</strong> ${sec.keyTakeaway}
            </div>
          </div>
        `;
      }

      html += `</div>`;
    });

    // Bottom Navigation
    const prevId = chapter.id > 1 ? chapter.id - 1 : null;
    const nextId = chapter.id < 5 ? chapter.id + 1 : null;

    html += `
      <div class="chapter-bottom-nav">
        <div>
          ${prevId ? `
            <a href="#chapter/${prevId}" class="btn btn-secondary">
              ${window.getIcon('arrow-left')} บทที่ ${prevId}
            </a>
          ` : `<span></span>`}
        </div>

        <div>
          <button class="btn btn-primary" id="btnLaunchChapterQuizBottom" data-chapter="${chapter.id}">
            ${window.getIcon('play')} ทำแบบทดสอบบทที่ ${chapter.id} (30 ข้อ)
          </button>
        </div>

        <div>
          ${nextId ? `
            <a href="#chapter/${nextId}" class="btn btn-secondary">
              บทที่ ${nextId} ${window.getIcon('arrow-right')}
            </a>
          ` : `<span></span>`}
        </div>
      </div>
    `;

    container.innerHTML = html;

    document.getElementById('btnLaunchChapterQuizBottom')?.addEventListener('click', () => {
      openQuizSettingsModal(chapter.id);
    });
  }

  // Simple Markdown Formatter for section content
  function formatMarkdownSimple(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:var(--bg-secondary);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13.5px;">$1</code>');
  }

  // Render: Quiz Hub (Center)
  function renderQuizHub(container) {
    const chapters = window.CHAPTERS_DATA || [];
    let html = `
      <div class="breadcrumb">
        <a href="#home">${window.getIcon('home')} หน้าหลัก</a>
        <span>/</span>
        <span>ศูนย์แบบทดสอบ</span>
      </div>

      <div class="hero-card" style="margin-bottom: 28px;">
        <div class="hero-tag">
          ${window.getIcon('award')} คลังข้อสอบ 150 ข้อ
        </div>
        <h1 class="hero-title">ศูนย์แบบทดสอบทบทวนวิชา IoT</h1>
        <p class="hero-subtitle">
          เลือกทำแบบทดสอบเจาะจงรายบท (บทละ 30 ข้อ) หรือเลือกทำแบบทดสอบรวมทุกบท สามารถเปิดระบบสุ่มข้อสอบ สุ่มชอยส์ 
          และปรับเลือกได้ว่าจะให้เฉลยทันทีข้อต่อข้อ หรือเฉลยหลังจากทำเสร็จทั้งหมด
        </p>

        <div style="margin-top: 20px;">
          <button class="btn btn-primary" id="btnStartAllFromHub">
            ${window.getIcon('shuffle')} ทำแบบทดสอบรวมทุกบท (150 ข้อ)
          </button>
        </div>
      </div>

      <div class="section-header">
        <h2>${window.getIcon('help-circle')} เลือกทำแบบทดสอบเฉพาะบท (30 ข้อต่อบท)</h2>
      </div>

      <div class="chapter-grid">
    `;

    chapters.forEach(ch => {
      html += `
        <div class="chapter-card">
          <div class="chapter-card-top">
            <div class="chapter-badge-wrap">
              <span class="chapter-pill">บทที่ ${ch.id}</span>
              <div class="chapter-icon-circle">${window.getIcon(ch.icon)}</div>
            </div>
            <h3 class="chapter-title">${ch.title}</h3>
            <p class="chapter-desc">ข้อสอบมาตรฐาน 30 ข้อ ครอบคลุมเนื้อหาบทที่ ${ch.id} ทั้งหมด</p>
          </div>
          <div class="chapter-card-actions">
            <a href="#chapter/${ch.id}" class="btn btn-sm btn-secondary">
              ${window.getIcon('book-open')} อ่านสรุป
            </a>
            <button class="btn btn-sm btn-primary btn-start-chapter-quiz" data-chapter="${ch.id}">
              ${window.getIcon('play')} เริ่มทำข้อสอบ
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    document.getElementById('btnStartAllFromHub')?.addEventListener('click', () => {
      openQuizSettingsModal(null);
    });

    document.querySelectorAll('.btn-start-chapter-quiz').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cid = parseInt(e.currentTarget.getAttribute('data-chapter'), 10);
        openQuizSettingsModal(cid);
      });
    });
  }

  // Quiz Settings Modal & Setup
  function openQuizSettingsModal(chapterId = null) {
    const modal = document.getElementById('quizSettingsModal');
    if (!modal) return;

    const modalTitle = document.getElementById('modalQuizTitle');
    const modalSubtitle = document.getElementById('modalQuizSubtitle');
    const questionCountGroup = document.getElementById('modalQuestionCountGroup');

    if (chapterId) {
      const ch = (window.CHAPTERS_DATA || []).find(c => c.id === chapterId);
      modalTitle.innerHTML = `${window.getIcon('play')} เริ่มทำแบบทดสอบบทที่ ${chapterId}`;
      modalSubtitle.textContent = ch ? ch.title : `ข้อสอบบทที่ ${chapterId} (30 ข้อ)`;
      if (questionCountGroup) questionCountGroup.style.display = 'none';
    } else {
      modalTitle.innerHTML = `${window.getIcon('shuffle')} เริ่มทำแบบทดสอบรวมทุกบท`;
      modalSubtitle.textContent = 'รวมข้อสอบจากทั้ง 5 บท (สูงสุด 150 ข้อ)';
      if (questionCountGroup) questionCountGroup.style.display = 'block';
    }

    // Set form controls to match current state
    const chkShuffleQ = document.getElementById('chkShuffleQuestions');
    const chkShuffleC = document.getElementById('chkShuffleChoices');
    if (chkShuffleQ) chkShuffleQ.checked = state.settings.shuffleQuestions;
    if (chkShuffleC) chkShuffleC.checked = state.settings.shuffleChoices;

    const radioInstant = document.querySelector('input[name="feedbackMode"][value="instant"]');
    const radioExam = document.querySelector('input[name="feedbackMode"][value="exam"]');
    if (state.settings.feedbackMode === 'instant' && radioInstant) radioInstant.checked = true;
    if (state.settings.feedbackMode === 'exam' && radioExam) radioExam.checked = true;

    // Radio card active class updates
    document.querySelectorAll('input[name="feedbackMode"]').forEach(radio => {
      radio.onchange = () => {
        document.querySelectorAll('input[name="feedbackMode"]').forEach(r => {
          r.closest('.radio-card')?.classList.toggle('active', r.checked);
        });
      };
      radio.closest('.radio-card')?.classList.toggle('active', radio.checked);
    });

    document.querySelectorAll('input[name="questionCountOption"]').forEach(radio => {
      radio.onchange = () => {
        document.querySelectorAll('input[name="questionCountOption"]').forEach(r => {
          r.closest('.radio-card')?.classList.toggle('active', r.checked);
        });
      };
      radio.closest('.radio-card')?.classList.toggle('active', radio.checked);
    });

    // Attach start button event
    const startBtn = document.getElementById('btnConfirmStartQuiz');
    startBtn.onclick = () => {
      state.settings.shuffleQuestions = chkShuffleQ.checked;
      state.settings.shuffleChoices = chkShuffleC.checked;
      const selectedMode = document.querySelector('input[name="feedbackMode"]:checked')?.value || 'instant';
      state.settings.feedbackMode = selectedMode;

      if (!chapterId) {
        const countRadio = document.querySelector('input[name="questionCountOption"]:checked');
        state.settings.examQuestionCount = countRadio ? parseInt(countRadio.value, 10) : 150;
      }

      closeQuizSettingsModal();
      startQuizSession(chapterId);
    };

    modal.classList.add('active');
  }

  function closeQuizSettingsModal() {
    const modal = document.getElementById('quizSettingsModal');
    if (modal) modal.classList.remove('active');
  }

  // Quiz Session Engine
  function startQuizSession(chapterId = null) {
    const allQuestions = window.QUESTIONS_DATA || [];
    let pool = [];

    if (chapterId) {
      pool = allQuestions.filter(q => q.chapterId === chapterId);
    } else {
      pool = [...allQuestions];
    }

    // Shuffle questions if requested
    if (state.settings.shuffleQuestions) {
      pool = shuffleArray(pool);
    }

    // Limit count for all-chapters mode if needed
    if (!chapterId && state.settings.examQuestionCount && state.settings.examQuestionCount < pool.length) {
      pool = pool.slice(0, state.settings.examQuestionCount);
    }

    // Prepare questions with choice shuffling if requested
    const prepared = pool.map(orig => {
      let optionsWithMeta = orig.options.map((text, idx) => ({
        text,
        isCorrect: idx === orig.answer,
        origIndex: idx
      }));

      if (state.settings.shuffleChoices) {
        optionsWithMeta = shuffleArray(optionsWithMeta);
      }

      const newAnswerIndex = optionsWithMeta.findIndex(o => o.isCorrect);

      return {
        id: orig.id,
        chapterId: orig.chapterId,
        question: orig.question,
        options: optionsWithMeta.map(o => o.text),
        answer: newAnswerIndex,
        explanation: orig.explanation
      };
    });

    // Reset quiz state
    clearInterval(state.quiz.timerInterval);
    state.quiz = {
      active: true,
      chapterId: chapterId,
      title: chapterId ? `แบบทดสอบบทที่ ${chapterId}` : 'แบบทดสอบรวมทุกบท',
      subtitle: chapterId ? `ข้อสอบทบทวน 30 ข้อ` : `รวมข้อสอบ ${prepared.length} ข้อ`,
      questions: prepared,
      currentIndex: 0,
      userAnswers: {},
      flagged: {},
      timerSeconds: 0,
      timerInterval: null,
      submitted: false,
      results: null,
      mode: state.settings.feedbackMode
    };

    // Start timer
    state.quiz.timerInterval = setInterval(() => {
      state.quiz.timerSeconds++;
      const timerEl = document.getElementById('quizTimerDisplay');
      if (timerEl) {
        timerEl.textContent = formatTime(state.quiz.timerSeconds);
      }
    }, 1000);

    const appRoot = document.getElementById('app-root');
    renderQuizActive(appRoot);
  }

  // Render: Active Quiz View
  function renderQuizActive(container) {
    if (!state.quiz.active || state.quiz.questions.length === 0) {
      navigateTo('quiz-hub');
      return;
    }

    const q = state.quiz.questions[state.quiz.currentIndex];
    const totalQ = state.quiz.questions.length;
    const currentNum = state.quiz.currentIndex + 1;
    const progressPercent = Math.round((currentNum / totalQ) * 100);
    const isInstant = state.settings.feedbackMode === 'instant';
    const chosenAnswer = state.quiz.userAnswers[state.quiz.currentIndex];
    const isAnswered = chosenAnswer !== undefined;
    const isFlagged = !!state.quiz.flagged[state.quiz.currentIndex];

    const letters = ['ก', 'ข', 'ค', 'ง'];

    let html = `
      <div class="quiz-container">
        <!-- Sticky Header Card -->
        <div class="quiz-header-card">
          <div class="quiz-progress-wrap">
            <div class="progress-info">
              <span>${state.quiz.title}</span>
              <span><strong>ข้อที่ ${currentNum}</strong> / ${totalQ} (${progressPercent}%)</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
          </div>

          <div class="quiz-controls-bar">
            <div class="control-badge" title="เวลาที่ใช้">
              ${window.getIcon('clock')}
              <span id="quizTimerDisplay">${formatTime(state.quiz.timerSeconds)}</span>
            </div>

            <button class="btn-flag ${isFlagged ? 'flagged' : ''}" id="btnFlagQuestion" title="ปักหมุดข้อที่ต้องการกลับมาดู">
              ${window.getIcon('flag')}
              <span>${isFlagged ? 'ปักหมุดแล้ว' : 'ปักหมุด'}</span>
            </button>

            <button class="btn btn-sm btn-secondary" id="btnExitQuiz">
              ${window.getIcon('x')} ออก
            </button>
          </div>
        </div>

        <!-- Question Stem Card -->
        <div class="question-card">
          <div class="question-meta">
            <span class="question-chapter-badge">บทที่ ${q.chapterId}</span>
            <span style="font-size: 13.5px; color: var(--text-muted);">โหมด: ${isInstant ? 'เฉลยทันทีข้อต่อข้อ' : 'สอบวัดผล (เฉลยตอนส่ง)'}</span>
          </div>

          <div class="question-stem">
            ${currentNum}. ${q.question}
          </div>

          <!-- Options -->
          <div class="options-list">
    `;

    q.options.forEach((optText, optIdx) => {
      let btnClasses = ['option-btn'];
      const isSelected = chosenAnswer === optIdx;

      if (isInstant && isAnswered) {
        if (optIdx === q.answer) {
          btnClasses.push('correct');
        } else if (isSelected) {
          btnClasses.push('wrong');
        }
      } else if (isSelected) {
        btnClasses.push('selected');
      }

      const disabledAttr = (isInstant && isAnswered) ? 'disabled' : '';

      html += `
        <button class="${btnClasses.join(' ')}" data-opt="${optIdx}" ${disabledAttr}>
          <span class="option-letter">${letters[optIdx] || optIdx + 1}</span>
          <span>${optText}</span>
        </button>
      `;
    });

    html += `</div>`;

    // Instant Feedback Explanation Box
    if (isInstant && isAnswered) {
      const isCorrect = chosenAnswer === q.answer;
      html += `
        <div class="explanation-box" style="border-left-color: ${isCorrect ? 'var(--success)' : 'var(--danger)'};">
          <div class="explanation-title" style="color: ${isCorrect ? 'var(--success)' : 'var(--danger)'};">
            ${isCorrect ? window.getIcon('check-circle') : window.getIcon('x-circle')}
            <span>${isCorrect ? 'คำตอบถูกต้อง!' : 'ยังไม่ถูกต้อง (คำตอบที่ถูกคือข้อ ' + letters[q.answer] + ')'}</span>
          </div>
          <div class="explanation-text">
            <strong>คำอธิบายเฉลย:</strong> ${q.explanation}
          </div>
        </div>
      `;
    }

    html += `
        </div> <!-- /question-card -->

        <!-- Navigation Actions Bar -->
        <div class="quiz-nav-actions">
          <button class="btn btn-secondary" id="btnPrevQuestion" ${state.quiz.currentIndex === 0 ? 'disabled style="opacity:0.4;"' : ''}>
            ${window.getIcon('arrow-left')} ข้อก่อนหน้า
          </button>

          <div style="display: flex; gap: 10px;">
            ${currentNum < totalQ ? `
              <button class="btn btn-primary" id="btnNextQuestion">
                ข้อถัดไป ${window.getIcon('arrow-right')}
              </button>
            ` : `
              <button class="btn btn-primary" id="btnSubmitQuiz" style="background-color: var(--success);">
                ${window.getIcon('check')} ส่งแบบทดสอบ
              </button>
            `}
          </div>
        </div>

        <!-- Question Palette / Grid -->
        <div class="palette-card">
          <div class="palette-title">
            <span>ตารางข้อสอบ (${Object.keys(state.quiz.userAnswers).length}/${totalQ} ข้อที่ทำแล้ว)</span>
            <span style="font-size: 13px; color: var(--text-muted); font-weight: normal;">คลิกเพื่อกระโดดไปยังข้อที่ต้องการ</span>
          </div>
          <div class="palette-grid">
    `;

    state.quiz.questions.forEach((pq, pidx) => {
      let pClass = ['palette-btn'];
      if (pidx === state.quiz.currentIndex) pClass.push('current');
      if (state.quiz.flagged[pidx]) pClass.push('flagged-pill');

      const ans = state.quiz.userAnswers[pidx];
      if (ans !== undefined) {
        if (isInstant) {
          if (ans === pq.answer) pClass.push('correct-pill');
          else pClass.push('wrong-pill');
        } else {
          pClass.push('answered');
        }
      }

      html += `
        <button class="${pClass.join(' ')}" data-jump="${pidx}">
          ${pidx + 1}
        </button>
      `;
    });

    html += `
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Attach Active Quiz Listeners
    // Option Click
    container.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const optIdx = parseInt(e.currentTarget.getAttribute('data-opt'), 10);
        state.quiz.userAnswers[state.quiz.currentIndex] = optIdx;
        renderQuizActive(container);
      });
    });

    // Next / Prev Buttons
    document.getElementById('btnPrevQuestion')?.addEventListener('click', () => {
      if (state.quiz.currentIndex > 0) {
        state.quiz.currentIndex--;
        renderQuizActive(container);
      }
    });

    document.getElementById('btnNextQuestion')?.addEventListener('click', () => {
      if (state.quiz.currentIndex < state.quiz.questions.length - 1) {
        state.quiz.currentIndex++;
        renderQuizActive(container);
      }
    });

    // Flag Question Button
    document.getElementById('btnFlagQuestion')?.addEventListener('click', () => {
      state.quiz.flagged[state.quiz.currentIndex] = !state.quiz.flagged[state.quiz.currentIndex];
      renderQuizActive(container);
    });

    // Palette Jump
    container.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const jumpIdx = parseInt(e.currentTarget.getAttribute('data-jump'), 10);
        state.quiz.currentIndex = jumpIdx;
        renderQuizActive(container);
      });
    });

    // Submit Quiz Button
    document.getElementById('btnSubmitQuiz')?.addEventListener('click', () => {
      const answeredCount = Object.keys(state.quiz.userAnswers).length;
      const unAns = totalQ - answeredCount;
      if (unAns > 0) {
        const confirmSub = confirm(`คุณยังไม่ได้ตอบอีก ${unAns} ข้อ ต้องการส่งแบบทดสอบเลยหรือไม่?`);
        if (!confirmSub) return;
      }
      finishQuiz();
    });

    // Exit Quiz Button
    document.getElementById('btnExitQuiz')?.addEventListener('click', () => {
      const confirmExit = confirm('ต้องการออกจากแบบทดสอบหรือไม่? ข้อมูลการทำในรอบนี้จะไม่ถูกบันทึก');
      if (confirmExit) {
        clearInterval(state.quiz.timerInterval);
        state.quiz.active = false;
        navigateTo('quiz-hub');
      }
    });
  }

  // Finish Quiz and Calculate Results
  function finishQuiz() {
    clearInterval(state.quiz.timerInterval);
    state.quiz.submitted = true;

    let score = 0;
    const total = state.quiz.questions.length;
    const chapterStats = {
      1: { correct: 0, total: 0 },
      2: { correct: 0, total: 0 },
      3: { correct: 0, total: 0 },
      4: { correct: 0, total: 0 },
      5: { correct: 0, total: 0 }
    };

    const details = state.quiz.questions.map((q, idx) => {
      const userChoice = state.quiz.userAnswers[idx];
      const isCorrect = userChoice === q.answer;
      if (isCorrect) score++;

      if (chapterStats[q.chapterId]) {
        chapterStats[q.chapterId].total++;
        if (isCorrect) chapterStats[q.chapterId].correct++;
      }

      return {
        index: idx,
        id: q.id,
        chapterId: q.chapterId,
        question: q.question,
        options: q.options,
        userChoice: userChoice,
        correctChoice: q.answer,
        isCorrect: isCorrect,
        isFlagged: !!state.quiz.flagged[idx],
        explanation: q.explanation
      };
    });

    const percent = Math.round((score / total) * 100);

    state.quiz.results = {
      score,
      total,
      percent,
      passed: percent >= 60,
      timeSpent: state.quiz.timerSeconds,
      chapterStats,
      details
    };

    // Save record to Exam History in LocalStorage
    const now = new Date();
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const thaiYear = now.getFullYear() + 543;
    const day = now.getDate();
    const month = thaiMonths[now.getMonth()];
    const hours = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');
    const dateFormatted = `${day} ${month} ${thaiYear}, ${hours}:${mins} น.`;

    let quizTitle = 'แบบทดสอบรวมทุกบท (150 ข้อ)';
    if (state.quiz.chapterId) {
      const ch = (window.CHAPTERS_DATA || []).find(c => c.id === state.quiz.chapterId);
      quizTitle = ch ? ch.title : `แบบทดสอบบทที่ ${state.quiz.chapterId} (30 ข้อ)`;
    }

    const historyRecord = {
      id: 'exam_' + Date.now(),
      timestamp: Date.now(),
      dateStr: dateFormatted,
      chapterId: state.quiz.chapterId,
      title: quizTitle,
      score: score,
      total: total,
      percent: percent,
      passed: percent >= 60,
      timeSpent: state.quiz.timerSeconds,
      timeSpentStr: formatTime(state.quiz.timerSeconds),
      mode: state.quiz.mode || state.settings.feedbackMode,
      modeStr: (state.quiz.mode || state.settings.feedbackMode) === 'instant' ? 'เฉลยทันทีข้อต่อข้อ' : 'สอบวัดผล (เฉลยตอนส่ง)'
    };

    saveExamResult(historyRecord);

    state.reviewFilter = 'all';
    navigateTo('result');
  }

  // Render: Quiz Result Screen
  function renderQuizResult(container) {
    if (!state.quiz.results) {
      navigateTo('quiz-hub');
      return;
    }

    const res = state.quiz.results;
    const letters = ['ก', 'ข', 'ค', 'ง'];

    let filteredDetails = res.details;
    if (state.reviewFilter === 'wrong') {
      filteredDetails = res.details.filter(d => !d.isCorrect);
    } else if (state.reviewFilter === 'correct') {
      filteredDetails = res.details.filter(d => d.isCorrect);
    } else if (state.reviewFilter === 'flagged') {
      filteredDetails = res.details.filter(d => d.isFlagged);
    }

    let html = `
      <div class="quiz-container">
        <!-- History Saved Notice -->
        <div class="result-history-notice">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${window.getIcon('check-circle')}
            <span>บันทึกประวัติและคะแนนการสอบลงในเครื่องของคุณเรียบร้อยแล้ว</span>
          </div>
          <a href="#settings" class="btn btn-secondary btn-sm" style="font-size: 13px;">
            ${window.getIcon('history')} ดูประวัติการสอบ
          </a>
        </div>

        <!-- Result Hero Card -->
        <div class="result-card">
          <div class="result-badge ${res.passed ? 'passed' : 'failed'}">
            ${res.passed ? window.getIcon('award') : window.getIcon('x-circle')}
          </div>
          <div class="result-score-large">${res.score} / ${res.total}</div>
          <div class="result-verdict ${res.passed ? 'passed' : 'failed'}">
            ${res.passed ? 'ยินดีด้วย! คุณผ่านเกณฑ์การทดสอบ' : 'ยังไม่ผ่านเกณฑ์ (เกณฑ์ผ่าน 60%)'} (${res.percent}%)
          </div>
          <p style="color: var(--text-secondary); font-size: 15px;">
            ${res.passed ? 'คุณมีความเข้าใจในเนื้อหา IoT เป็นอย่างดี สามารถทบทวนข้อที่ผิดเพื่อความแม่นยำยิ่งขึ้น' : 'แนะนำให้กลับไปอ่านสรุปเนื้อหาบทที่มีคะแนนต่ำ แล้วลองฝึกทำแบบทดสอบอีกครั้ง'}
          </p>

          <div class="result-summary-grid">
            <div>
              <div style="font-size: 13px; color: var(--text-muted);">เวลาที่ใช้</div>
              <div style="font-family: var(--font-heading); font-size: 18px; font-weight: 700;">${formatTime(res.timeSpent)}</div>
            </div>
            <div>
              <div style="font-size: 13px; color: var(--text-muted);">ตอบถูก</div>
              <div style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; color: var(--success);">${res.score} ข้อ</div>
            </div>
            <div>
              <div style="font-size: 13px; color: var(--text-muted);">ตอบผิด / ไม่ได้ตอบ</div>
              <div style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; color: var(--danger);">${res.total - res.score} ข้อ</div>
            </div>
            <div>
              <div style="font-size: 13px; color: var(--text-muted);">ปักหมุดไว้</div>
              <div style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; color: var(--warning);">${Object.values(state.quiz.flagged).filter(Boolean).length} ข้อ</div>
            </div>
          </div>

          <div style="margin-top: 24px; display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <button class="btn btn-primary" id="btnRetakeSameQuiz">
              ${window.getIcon('rotate-ccw')} ทำแบบทดสอบชุดนี้ใหม่
            </button>
            <a href="#settings" class="btn btn-secondary">
              ${window.getIcon('history')} ดูประวัติการสอบ
            </a>
            <a href="#quiz-hub" class="btn btn-secondary">
              ${window.getIcon('help-circle')} กลับศูนย์แบบทดสอบ
            </a>
            <a href="#chapters" class="btn btn-secondary">
              ${window.getIcon('book-open')} ไปอ่านสรุปเนื้อหา
            </a>
          </div>
        </div>

        <!-- Breakdown by Chapter -->
        <div class="breakdown-card">
          <h3 style="font-size: 18px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
            ${window.getIcon('bar-chart')} ผลวิเคราะห์คะแนนแยกตามบท
          </h3>
    `;

    const chapterTitles = {
      1: 'บทที่ 1: เทคโนโลยีการสื่อสารสำหรับระบบ IoT',
      2: 'บทที่ 2: คลาวด์คอมพิวติ้ง (Cloud Computing)',
      3: 'บทที่ 3: เอดจ์คอมพิวติ้ง (Edge Computing)',
      4: 'บทที่ 4: มิดเดิลแวร์ (Middleware)',
      5: 'บทที่ 5: อุปกรณ์และสถาปัตยกรรมสำหรับระบบ IoT'
    };

    for (let cid = 1; cid <= 5; cid++) {
      const cStat = res.chapterStats[cid];
      if (cStat && cStat.total > 0) {
        const cPct = Math.round((cStat.correct / cStat.total) * 100);
        html += `
          <div class="breakdown-item">
            <div style="flex: 1;">
              <strong>${chapterTitles[cid]}</strong>
            </div>
            <div class="breakdown-bar-wrap">
              <div style="height: 100%; width: ${cPct}%; background-color: ${cPct >= 60 ? 'var(--success)' : 'var(--danger)'};"></div>
            </div>
            <div style="font-family: var(--font-heading); font-weight: 600; min-width: 75px; text-align: right;">
              ${cStat.correct}/${cStat.total} (${cPct}%)
            </div>
          </div>
        `;
      }
    }

    html += `
        </div> <!-- /breakdown-card -->

        <!-- Answer Review Section -->
        <div class="section-header">
          <h2>${window.getIcon('check-circle')} เฉลยและคำอธิบายละเอียดทุกข้อ</h2>
        </div>

        <div class="review-filter-bar">
          <button class="filter-btn ${state.reviewFilter === 'all' ? 'active' : ''}" data-filter="all">
            ทั้งหมด (${res.details.length})
          </button>
          <button class="filter-btn ${state.reviewFilter === 'wrong' ? 'active' : ''}" data-filter="wrong">
            เฉพาะข้อที่ตอบผิด (${res.details.filter(d => !d.isCorrect).length})
          </button>
          <button class="filter-btn ${state.reviewFilter === 'correct' ? 'active' : ''}" data-filter="correct">
            เฉพาะข้อที่ตอบถูก (${res.details.filter(d => d.isCorrect).length})
          </button>
          <button class="filter-btn ${state.reviewFilter === 'flagged' ? 'active' : ''}" data-filter="flagged">
            เฉพาะข้อที่ปักหมุด (${res.details.filter(d => d.isFlagged).length})
          </button>
        </div>

        <div class="review-list">
    `;

    if (filteredDetails.length === 0) {
      html += `<div class="hero-card" style="text-align: center;"><p>ไม่มีรายการข้อสอบในตัวกรองนี้</p></div>`;
    } else {
      filteredDetails.forEach(item => {
        html += `
          <div class="review-item ${item.isCorrect ? 'is-correct' : 'is-wrong'}">
            <div class="question-meta">
              <span class="question-chapter-badge">บทที่ ${item.chapterId}</span>
              <span style="font-weight: 600; color: ${item.isCorrect ? 'var(--success)' : 'var(--danger)'};">
                ${item.isCorrect ? window.getIcon('check') + ' ถูกต้อง' : window.getIcon('x') + ' ไม่ถูกต้อง'}
              </span>
            </div>

            <div style="font-family: var(--font-heading); font-size: 16.5px; font-weight: 600; margin-bottom: 14px;">
              ข้อ ${item.index + 1}. ${item.question}
            </div>

            <div class="options-list" style="margin-bottom: 16px;">
        `;

        item.options.forEach((optText, optIdx) => {
          let optClass = ['option-btn'];
          const isUserChoice = item.userChoice === optIdx;
          const isCorrectChoice = item.correctChoice === optIdx;

          if (isCorrectChoice) {
            optClass.push('correct');
          } else if (isUserChoice) {
            optClass.push('wrong');
          }

          html += `
            <div class="${optClass.join(' ')}" style="cursor: default;">
              <span class="option-letter">${letters[optIdx] || optIdx + 1}</span>
              <span style="flex: 1;">${optText}</span>
              ${isUserChoice ? `<span style="font-size:12px; font-weight:600; margin-left:8px;">(คุณเลือก)</span>` : ''}
              ${isCorrectChoice ? `<span style="font-size:12px; font-weight:600; color:var(--success); margin-left:8px;">(คำตอบที่ถูก)</span>` : ''}
            </div>
          `;
        });

        html += `
            </div>

            <div class="explanation-box" style="margin-top: 12px;">
              <div class="explanation-title" style="color: var(--primary);">
                ${window.getIcon('info')} คำอธิบายเฉลย
              </div>
              <div class="explanation-text">
                ${item.explanation}
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `
        </div> <!-- /review-list -->
      </div> <!-- /quiz-container -->
    `;

    container.innerHTML = html;

    // Filter Buttons Listener
    container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        state.reviewFilter = e.currentTarget.getAttribute('data-filter');
        renderQuizResult(container);
      });
    });

    // Retake Same Quiz
    document.getElementById('btnRetakeSameQuiz')?.addEventListener('click', () => {
      startQuizSession(state.quiz.chapterId);
    });
  }

  // Render: Settings & Exam History Page
  function renderSettings(container) {
    const history = getExamHistory();
    const stats = getExamStats();

    let html = `
      <div class="breadcrumb">
        <a href="#home">${window.getIcon('home', 'icon-sm')} หน้าหลัก</a>
        <span>/</span>
        <span style="color: var(--text-primary); font-weight: 500;">ตั้งค่าและประวัติการสอบ</span>
      </div>

      <div class="settings-container">
        <!-- Appearance Card -->
        <div class="settings-card">
          <div class="settings-header">
            <div class="settings-title-group">
              <div style="background-color: var(--primary-light); color: var(--primary); width: 36px; height: 36px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;">
                ${window.getIcon(state.theme === 'light' ? 'sun' : 'moon')}
              </div>
              <div>
                <h2 class="settings-title">ธีมการแสดงผล (Appearance)</h2>
                <div class="settings-desc">ปรับเปลี่ยนระหว่าง Light Mode และ Dark Mode เพื่อความสบายตาในการใช้งาน</div>
              </div>
            </div>
          </div>

          <div class="theme-chooser-grid">
            <button class="theme-choice-card theme-light ${state.theme === 'light' ? 'active' : ''}" id="btnThemeLight">
              <div class="theme-preview-icon">
                ${window.getIcon('sun')}
              </div>
              <div class="theme-choice-info">
                <div class="theme-choice-title">
                  <span>Light Mode (โหมดสว่าง)</span>
                  ${state.theme === 'light' ? `<span style="color: var(--primary);">${window.getIcon('check')}</span>` : ''}
                </div>
                <div class="theme-choice-sub">โทนสีสว่าง อ่านสบายตา เหมาะกับตอนกลางวัน</div>
              </div>
            </button>

            <button class="theme-choice-card theme-dark ${state.theme === 'dark' ? 'active' : ''}" id="btnThemeDark">
              <div class="theme-preview-icon">
                ${window.getIcon('moon')}
              </div>
              <div class="theme-choice-info">
                <div class="theme-choice-title">
                  <span>Dark Mode (โหมดมืด)</span>
                  ${state.theme === 'dark' ? `<span style="color: var(--primary);">${window.getIcon('check')}</span>` : ''}
                </div>
                <div class="theme-choice-sub">โทนสีมืด ถนอมสายตา เหมาะกับที่แสงน้อย</div>
              </div>
            </button>
          </div>
        </div>

        <!-- History & Stats Card -->
        <div class="settings-card">
          <div class="settings-header">
            <div class="settings-title-group">
              <div style="background-color: var(--primary-light); color: var(--primary); width: 36px; height: 36px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;">
                ${window.getIcon('history')}
              </div>
              <div>
                <h2 class="settings-title">ประวัติการสอบและสถิติสะสม (Exam History)</h2>
                <div class="settings-desc">บันทึกผลการทำแบบทดสอบทุกครั้งในหน่วยความจำของเครื่อง (LocalStorage)</div>
              </div>
            </div>

            ${history.length > 0 ? `
              <button class="btn btn-sm btn-secondary" id="btnClearHistoryBtn" style="color: var(--danger); border-color: rgba(239,68,68,0.3);">
                ${window.getIcon('trash-2')} ล้างประวัติทั้งหมด
              </button>
            ` : ''}
          </div>

          <!-- Stats Grid -->
          <div class="history-stats-grid">
            <div class="history-stat-card">
              <div class="history-stat-label">ทำแบบทดสอบไปแล้ว</div>
              <div class="history-stat-value">${stats.totalAttempts} <span style="font-size: 13px; font-weight: normal; color: var(--text-muted);">ครั้ง</span></div>
            </div>
            <div class="history-stat-card">
              <div class="history-stat-label">คะแนนเฉลี่ยสะสม</div>
              <div class="history-stat-value">${stats.avgScore}%</div>
            </div>
            <div class="history-stat-card">
              <div class="history-stat-label">คะแนนสูงสุดที่ทำได้</div>
              <div class="history-stat-value">${stats.maxScore}%</div>
            </div>
            <div class="history-stat-card">
              <div class="history-stat-label">ข้อสอบที่ทำไปทั้งหมด</div>
              <div class="history-stat-value">${stats.totalQuestions} <span style="font-size: 13px; font-weight: normal; color: var(--text-muted);">ข้อ</span></div>
            </div>
          </div>

          <!-- History Records List -->
          ${history.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">
                ${window.getIcon('history')}
              </div>
              <div class="empty-state-title">ยังไม่มีประวัติการทำแบบทดสอบ</div>
              <div class="empty-state-desc">
                เมื่อคุณทำแบบทดสอบในศูนย์ข้อสอบและส่งคำตอบ ระบบจะบันทึกคะแนน เวลาที่ใช้ และผลการประเมินไว้ที่นี่โดยอัตโนมัติ
              </div>
              <a href="#quiz-hub" class="btn btn-primary">
                ${window.getIcon('play')} ไปที่ศูนย์แบบทดสอบ
              </a>
            </div>
          ` : `
            <div class="history-list">
              ${history.map(item => `
                <div class="history-item-card" data-id="${item.id}">
                  <div class="history-item-top">
                    <div>
                      <div class="history-item-title">${item.title}</div>
                      <div class="history-item-date">
                        ${window.getIcon('clock')} ${item.dateStr}
                      </div>
                    </div>
                    <div class="history-score-badge ${item.passed ? 'passed' : 'failed'}">
                      ${item.score} / ${item.total} (${item.percent}%)
                      <span style="font-size: 12px; font-weight: 600; margin-left: 2px;">
                        ${item.passed ? 'ผ่าน' : 'ต้องทบทวน'}
                      </span>
                    </div>
                  </div>

                  <div class="history-score-bar-bg">
                    <div class="history-score-bar-fill ${item.passed ? 'passed' : 'failed'}" style="width: ${item.percent}%;"></div>
                  </div>

                  <div class="history-meta-row">
                    <div class="history-meta-tags">
                      <span class="history-meta-tag">
                        ${window.getIcon('clock')} เวลา: ${item.timeSpentStr} นาที
                      </span>
                      <span class="history-meta-tag">
                        ${window.getIcon('help-circle')} โหมด: ${item.modeStr}
                      </span>
                    </div>

                    <div class="history-item-actions">
                      <button class="btn btn-sm btn-secondary btn-retake-history" data-chapter="${item.chapterId !== null ? item.chapterId : 'all'}">
                        ${window.getIcon('rotate-ccw')} ทำซ้ำ
                      </button>
                      <button class="btn-icon-danger btn-delete-history" data-id="${item.id}" title="ลบประวัตินี้">
                        ${window.getIcon('trash-2')}
                      </button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Quiz Preferences Card -->
        <div class="settings-card">
          <div class="settings-header">
            <div class="settings-title-group">
              <div style="background-color: var(--primary-light); color: var(--primary); width: 36px; height: 36px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;">
                ${window.getIcon('shuffle')}
              </div>
              <div>
                <h2 class="settings-title">ค่าเริ่มต้นสำหรับทำแบบทดสอบ (Quiz Defaults)</h2>
                <div class="settings-desc">การตั้งค่าเหล่านี้จะถูกใช้เป็นค่าเริ่มต้นในทุกครั้งที่เริ่มทำข้อสอบ</div>
              </div>
            </div>
          </div>

          <div class="setting-group" style="margin-bottom: 0;">
            <div class="toggle-item">
              <div class="toggle-info">
                <span class="toggle-name">สุ่มลำดับข้อสอบเริ่มต้น</span>
                <span class="toggle-desc">สลับลำดับข้อสอบเพื่อฝึกความเข้าใจ ไม่ให้จำลำดับข้อเดิม</span>
              </div>
              <label class="switch">
                <input type="checkbox" id="prefShuffleQuestions" ${state.settings.shuffleQuestions ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="toggle-item">
              <div class="toggle-info">
                <span class="toggle-name">สุ่มลำดับตัวเลือก (ก, ข, ค, ง) เริ่มต้น</span>
                <span class="toggle-desc">สลับชอยส์เพื่อป้องกันการจำตำแหน่งตัวเลือก</span>
              </div>
              <label class="switch">
                <input type="checkbox" id="prefShuffleChoices" ${state.settings.shuffleChoices ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="toggle-item">
              <div class="toggle-info">
                <span class="toggle-name">โหมดตรวจคำตอบเริ่มต้น</span>
                <span class="toggle-desc">เลือกว่าจะให้เฉลยทันทีทีละข้อ หรือตรวจพร้อมกันหลังส่งแบบทดสอบทั้งหมด</span>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-sm ${state.settings.feedbackMode === 'instant' ? 'btn-primary' : 'btn-secondary'}" id="btnPrefInstant">
                  เฉลยทันที
                </button>
                <button class="btn btn-sm ${state.settings.feedbackMode === 'exam' ? 'btn-primary' : 'btn-secondary'}" id="btnPrefExam">
                  สอบวัดผล
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Listeners: Theme Chooser
    document.getElementById('btnThemeLight')?.addEventListener('click', () => {
      setTheme('light');
      renderSettings(container);
    });

    document.getElementById('btnThemeDark')?.addEventListener('click', () => {
      setTheme('dark');
      renderSettings(container);
    });

    // Listeners: History Actions
    document.getElementById('btnClearHistoryBtn')?.addEventListener('click', () => {
      const confirmed = confirm('คุณต้องการลบประวัติการสอบทั้งหมดใช่หรือไม่? (การกระทำนี้ไม่สามารถย้อนกลับได้)');
      if (confirmed) {
        clearAllExamHistory();
        renderSettings(container);
      }
    });

    container.querySelectorAll('.btn-delete-history').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (id) {
          deleteExamResult(id);
          renderSettings(container);
        }
      });
    });

    container.querySelectorAll('.btn-retake-history').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-chapter');
        if (target === 'all') {
          startQuizSession(null);
        } else {
          startQuizSession(parseInt(target, 10));
        }
      });
    });

    // Listeners: Preferences
    document.getElementById('prefShuffleQuestions')?.addEventListener('change', (e) => {
      state.settings.shuffleQuestions = e.target.checked;
      saveQuizPreferences(state.settings);
    });

    document.getElementById('prefShuffleChoices')?.addEventListener('change', (e) => {
      state.settings.shuffleChoices = e.target.checked;
      saveQuizPreferences(state.settings);
    });

    document.getElementById('btnPrefInstant')?.addEventListener('click', () => {
      state.settings.feedbackMode = 'instant';
      saveQuizPreferences(state.settings);
      renderSettings(container);
    });

    document.getElementById('btnPrefExam')?.addEventListener('click', () => {
      state.settings.feedbackMode = 'exam';
      saveQuizPreferences(state.settings);
      renderSettings(container);
    });
  }

  // Mobile Drawer Control
  function openMobileDrawer() {
    document.getElementById('mobileDrawer')?.classList.add('active');
    document.getElementById('mobileDrawerOverlay')?.classList.add('active');
  }

  function closeMobileDrawer() {
    document.getElementById('mobileDrawer')?.classList.remove('active');
    document.getElementById('mobileDrawerOverlay')?.classList.remove('active');
  }

  // Expose to window for external or test triggers
  window.appState = state;
  window.appStartQuiz = startQuizSession;
  window.appFinishQuiz = finishQuiz;
  window.appOpenSettings = openQuizSettingsModal;

  // App Initialization
  function initApp() {
    initTheme();

    // Event Listeners
    document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

    document.getElementById('mobileMenuBtn')?.addEventListener('click', openMobileDrawer);
    document.getElementById('btnCloseDrawer')?.addEventListener('click', closeMobileDrawer);
    document.getElementById('mobileDrawerOverlay')?.addEventListener('click', closeMobileDrawer);

    document.getElementById('btnModalClose')?.addEventListener('click', closeQuizSettingsModal);

    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  // Start app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
