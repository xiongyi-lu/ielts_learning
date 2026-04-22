;(function (root) {
  function normalizeAnswer(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  }

  function splitNormalizedAnswer(value) {
    return normalizeAnswer(value).split(" ").filter(Boolean)
  }

  function findFirstMismatchTokenIndex(expectedTokens, inputTokens) {
    const maxLength = Math.max(expectedTokens.length, inputTokens.length)
    for (let index = 0; index < maxLength; index += 1) {
      if ((expectedTokens[index] ?? "") !== (inputTokens[index] ?? "")) return index
    }
    return -1
  }

  function judgeAnswer(expected, input) {
    const normalizedExpected = normalizeAnswer(expected)
    const normalizedInput = normalizeAnswer(input)
    const expectedTokens = splitNormalizedAnswer(expected)
    const inputTokens = splitNormalizedAnswer(input)
    const isCorrect = normalizedExpected === normalizedInput
    return {
      expected,
      input,
      normalizedExpected,
      normalizedInput,
      isCorrect,
      firstMismatchTokenIndex: isCorrect ? -1 : findFirstMismatchTokenIndex(expectedTokens, inputTokens),
    }
  }

  function addMistake(mistakes, itemId) {
    const existing = Array.isArray(mistakes) ? mistakes : []
    if (!itemId || existing.includes(itemId)) return existing.slice()
    return [...existing, itemId]
  }

  function filterVocabulary(vocabulary, options = {}) {
    const scene = options.scene ?? "all"
    const reviewMode = options.reviewMode ?? "all"
    const mistakes = Array.isArray(options.mistakes) ? options.mistakes : []
    const mistakeSet = new Set(mistakes)
    return (Array.isArray(vocabulary) ? vocabulary : []).filter((item) => {
      const sceneMatches = scene === "all" || item.scene === scene
      const reviewMatches = reviewMode !== "mistakes" || mistakeSet.has(item.id)
      return sceneMatches && reviewMatches
    })
  }

  function summarizeQuizRound(results) {
    const safeResults = Array.isArray(results) ? results : []
    const wrongIds = []
    const seen = new Set()
    let correct = 0
    for (const result of safeResults) {
      if (result?.isCorrect) {
        correct += 1
        continue
      }
      const wrongId = result?.itemId ?? result?.id
      if (wrongId != null && !seen.has(wrongId)) {
        seen.add(wrongId)
        wrongIds.push(wrongId)
      }
    }
    return { total: safeResults.length, correct, incorrect: safeResults.length - correct, wrongIds }
  }

  function createRevealState(item) {
    return {
      itemId: item?.id ?? null,
      answer: item?.english ?? item?.answer ?? "",
      needsRetype: true,
    }
  }

  function canAdvanceFromSubmission({ revealState, isCorrect } = {}) {
    return !revealState?.needsRetype || Boolean(isCorrect)
  }

  function buildChoiceOptions(items, currentItem) {
    const options = []
    const seen = new Set()
    const currentAnswer = String(currentItem?.answer ?? "")
    if (currentAnswer) {
      options.push(currentAnswer)
      seen.add(normalizeAnswer(currentAnswer))
    }
    for (const item of Array.isArray(items) ? items : []) {
      const answer = String(item?.answer ?? "")
      const key = normalizeAnswer(answer)
      if (!answer || seen.has(key)) continue
      seen.add(key)
      options.push(answer)
      if (options.length >= 4) break
    }
    return options
  }

  function resolveSynonymQuestionType(mode, answered) {
    if (mode === "choice" || mode === "input") return mode
    return answered % 2 === 0 ? "choice" : "input"
  }

  const coreApi = {
    normalizeAnswer,
    judgeAnswer,
    filterVocabulary,
    addMistake,
    summarizeQuizRound,
    createRevealState,
    canAdvanceFromSubmission,
    buildChoiceOptions,
    resolveSynonymQuestionType,
  }

  root.IELTSVocabPracticeCore = coreApi
  if (typeof module !== "undefined" && module.exports) module.exports = coreApi

  if (typeof document === "undefined") return

  const STORAGE_KEY = "ielts-vocab-typing-site-v2"
  const LEGACY_STORAGE_KEY = "ielts-vocab-typing-site"
  const QUIZ_SIZE = 5

  const DOMAIN_META = {
    listening: {
      label: "听力模块",
      eyebrow: "IELTS Listening",
      title: "雅思听力与阅读练习站",
      summary: "保留原来的听力词汇与听力同义替换练习，同时把练习结构升级成听力 / 阅读双模块，方便按能力维度长期复习。",
      wordLabel: "听力词汇",
      synonymLabel: "听力同义替换",
      wordFilterLabel: "场景",
      wordFilterEmpty: "当前筛选下没有可练习的听力词汇。",
      synonymNote: "听力同义替换现已扩充为剑 10 到剑 20 的完整题库。",
    },
    reading: {
      label: "阅读模块",
      eyebrow: "IELTS Reading",
      title: "雅思听力与阅读练习站",
      summary: "阅读模块第一版包含阅读词汇与阅读同义替换两个子模块；阅读词汇数据基于阅读同义替换核心词整理，先保证结构完整和练习闭环。",
      wordLabel: "阅读词汇",
      synonymLabel: "阅读同义替换",
      wordFilterLabel: "题库",
      wordFilterEmpty: "当前筛选下没有可练习的阅读词汇。",
      synonymNote: "阅读同义替换第一版已接入可稳定整理出的阅读题库。",
    },
  }

  function defaultWordState() {
    return {
      scene: "all",
      mode: "drill",
      reviewMode: "all",
      deckCursor: 0,
      answered: 0,
      correct: 0,
      streak: 0,
      totalResponseMs: 0,
      timedAnswers: 0,
      mistakes: [],
      revealState: null,
      lastQuizSummary: null,
      roundQuestions: [],
      roundIndex: 0,
      quizRound: [],
      roundComplete: false,
    }
  }

  function defaultSynonymState() {
    return {
      mode: "mixed",
      reviewMode: "all",
      deckCursor: 0,
      answered: 0,
      correct: 0,
      totalResponseMs: 0,
      timedAnswers: 0,
      mistakes: [],
    }
  }

  function defaultDomainState() {
    return {
      word: defaultWordState(),
      synonym: defaultSynonymState(),
    }
  }

  function defaultState() {
    return {
      domain: "listening",
      practiceModule: "word",
      domains: {
        listening: defaultDomainState(),
        reading: defaultDomainState(),
      },
      feedback: null,
      answerValue: "",
      transitioning: false,
      questionStartedAt: 0,
    }
  }

  const app = {
    ready: false,
    state: defaultState(),
    el: null,
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]),
    )
  }

  function toInt(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
  }

  function cleanSummary(summary) {
    if (!summary || typeof summary !== "object") return null
    return {
      total: toInt(summary.total, 0),
      correct: toInt(summary.correct, 0),
      incorrect: toInt(summary.incorrect, 0),
      wrongIds: Array.isArray(summary.wrongIds) ? summary.wrongIds.filter(Boolean) : [],
    }
  }

  function cleanWordState(raw) {
    const defaults = defaultWordState()
    const state = { ...defaults, ...(raw && typeof raw === "object" ? raw : {}) }
    state.scene = String(state.scene ?? "all")
    state.mode = state.mode === "quiz" ? "quiz" : "drill"
    state.reviewMode = state.reviewMode === "mistakes" ? "mistakes" : "all"
    state.deckCursor = toInt(state.deckCursor, 0)
    state.answered = toInt(state.answered, 0)
    state.correct = toInt(state.correct, 0)
    state.streak = toInt(state.streak, 0)
    state.totalResponseMs = toInt(state.totalResponseMs, 0)
    state.timedAnswers = toInt(state.timedAnswers, 0)
    state.mistakes = Array.isArray(state.mistakes) ? state.mistakes.filter(Boolean) : []
    state.revealState =
      state.revealState && typeof state.revealState === "object"
        ? {
            itemId: state.revealState.itemId ?? null,
            answer: String(state.revealState.answer ?? ""),
            needsRetype: Boolean(state.revealState.needsRetype),
          }
        : null
    state.lastQuizSummary = cleanSummary(state.lastQuizSummary)
    state.roundQuestions = Array.isArray(state.roundQuestions) ? state.roundQuestions.filter(Boolean) : []
    state.roundIndex = toInt(state.roundIndex, 0)
    state.quizRound = Array.isArray(state.quizRound) ? state.quizRound.filter(Boolean) : []
    state.roundComplete = Boolean(state.roundComplete)
    return state
  }

  function cleanSynonymState(raw) {
    const defaults = defaultSynonymState()
    const state = { ...defaults, ...(raw && typeof raw === "object" ? raw : {}) }
    state.mode = state.mode === "choice" || state.mode === "input" ? state.mode : "mixed"
    state.reviewMode = state.reviewMode === "mistakes" ? "mistakes" : "all"
    state.deckCursor = toInt(state.deckCursor, 0)
    state.answered = toInt(state.answered, 0)
    state.correct = toInt(state.correct, 0)
    state.totalResponseMs = toInt(state.totalResponseMs, 0)
    state.timedAnswers = toInt(state.timedAnswers, 0)
    state.mistakes = Array.isArray(state.mistakes) ? state.mistakes.filter(Boolean) : []
    return state
  }

  function cleanState(raw) {
    const defaults = defaultState()
    const value = raw && typeof raw === "object" ? raw : {}
    const domains = value.domains && typeof value.domains === "object" ? value.domains : {}
    return {
      ...defaults,
      domain: value.domain === "reading" ? "reading" : "listening",
      practiceModule: value.practiceModule === "synonym" ? "synonym" : "word",
      domains: {
        listening: {
          word: cleanWordState(domains.listening?.word),
          synonym: cleanSynonymState(domains.listening?.synonym),
        },
        reading: {
          word: cleanWordState(domains.reading?.word),
          synonym: cleanSynonymState(domains.reading?.synonym),
        },
      },
      feedback: null,
      answerValue: "",
      transitioning: false,
      questionStartedAt: 0,
    }
  }

  function migrateLegacyState(legacy) {
    if (!legacy || typeof legacy !== "object") return null
    const migrated = defaultState()
    migrated.domain = "listening"
    migrated.practiceModule = legacy.practiceModule === "synonym" ? "synonym" : "word"
    migrated.domains.listening.word = cleanWordState({
      scene: legacy.scene,
      mode: legacy.mode,
      reviewMode: legacy.reviewMode,
      deckCursor: legacy.deckCursor,
      answered: legacy.answered,
      correct: legacy.correct,
      streak: legacy.streak,
      totalResponseMs: legacy.totalResponseMs,
      timedAnswers: legacy.timedAnswers,
      mistakes: legacy.mistakes,
      revealState: legacy.revealState,
      lastQuizSummary: legacy.lastQuizSummary,
      roundQuestions: legacy.roundQuestions,
      roundIndex: legacy.roundIndex,
      quizRound: legacy.quizRound,
      roundComplete: legacy.roundComplete,
    })
    migrated.domains.listening.synonym = cleanSynonymState({
      mode: legacy.synonymMode,
      reviewMode: legacy.synonymReviewMode,
      deckCursor: legacy.synonymDeckCursor,
      answered: legacy.synonymAnswered,
      correct: legacy.synonymCorrect,
      totalResponseMs: legacy.synonymTotalResponseMs,
      timedAnswers: legacy.synonymTimedAnswers,
      mistakes: legacy.synonymMistakes,
    })
    return migrated
  }

  function loadState() {
    try {
      if (typeof localStorage === "undefined") return defaultState()
      const currentRaw = localStorage.getItem(STORAGE_KEY)
      if (currentRaw) return cleanState(JSON.parse(currentRaw))
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (!legacyRaw) return defaultState()
      return cleanState(migrateLegacyState(JSON.parse(legacyRaw)))
    } catch {
      return defaultState()
    }
  }

  function saveState() {
    try {
      if (typeof localStorage === "undefined") return
      const snapshot = {
        domain: app.state.domain,
        practiceModule: app.state.practiceModule,
        domains: app.state.domains,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {}
  }

  function listeningVocab() {
    return Array.isArray(root.VOCAB_DATA) ? root.VOCAB_DATA : []
  }

  function readingVocab() {
    return Array.isArray(root.READING_VOCAB_DATA) ? root.READING_VOCAB_DATA : []
  }

  function synonyms() {
    return Array.isArray(root.SYNONYM_DATA) ? root.SYNONYM_DATA : []
  }

  function activeDomainState() {
    return app.state.domains[app.state.domain]
  }

  function activeWordState() {
    return activeDomainState().word
  }

  function activeSynonymState() {
    return activeDomainState().synonym
  }

  function currentDomainMeta() {
    return DOMAIN_META[app.state.domain]
  }

  function currentVocabData() {
    return app.state.domain === "reading" ? readingVocab() : listeningVocab()
  }

  function currentSynonymData() {
    return synonyms().filter((item) => item.domain === app.state.domain)
  }

  function currentWordList() {
    const state = activeWordState()
    return filterVocabulary(currentVocabData(), {
      scene: state.scene,
      reviewMode: state.reviewMode,
      mistakes: state.mistakes,
    })
  }

  function currentSynonymList() {
    const state = activeSynonymState()
    const mistakeSet = new Set(state.mistakes)
    return currentSynonymData().filter((item) => state.reviewMode !== "mistakes" || mistakeSet.has(item.id))
  }

  function clampCursor(cursor, size) {
    if (!size) return 0
    return Math.min(Math.max(cursor, 0), size - 1)
  }

  function currentWordQuestion() {
    const state = activeWordState()
    const list = currentWordList()
    if (!list.length) return null
    if (state.mode === "quiz" && state.roundQuestions.length) {
      return state.roundQuestions[clampCursor(state.roundIndex, state.roundQuestions.length)]
    }
    return list[clampCursor(state.deckCursor, list.length)]
  }

  function currentSynonymQuestion() {
    const state = activeSynonymState()
    const list = currentSynonymList()
    if (!list.length) return null
    return list[clampCursor(state.deckCursor, list.length)]
  }

  function currentQuestion() {
    return app.state.practiceModule === "synonym" ? currentSynonymQuestion() : currentWordQuestion()
  }

  function currentSynonymQuestionType() {
    const state = activeSynonymState()
    return resolveSynonymQuestionType(state.mode, state.answered)
  }

  function sceneOptions() {
    const options = [{ value: "all", label: "全部题目" }]
    const seen = new Set(["all"])
    for (const item of currentVocabData()) {
      if (!item?.scene || seen.has(item.scene)) continue
      seen.add(item.scene)
      options.push({ value: item.scene, label: item.sceneLabel ?? item.scene })
    }
    return options
  }

  function wordModeLabel(mode) {
    return mode === "quiz" ? "小测模式" : "逐词练习"
  }

  function reviewModeLabel(mode) {
    return mode === "mistakes" ? "错题复习" : "全部题目"
  }

  function synonymModeLabel(mode) {
    return mode === "choice" ? "选择题" : mode === "input" ? "输入题" : "混合模式"
  }

  function formatMs(value) {
    return value <= 0 ? "0.0s" : `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`
  }

  function averageResponseMs(totalMs, count) {
    if (!count) return 0
    return Math.round(totalMs / count)
  }

  function resetTransientState() {
    app.state.feedback = null
    app.state.answerValue = ""
    app.state.transitioning = false
    app.state.questionStartedAt = 0
  }

  function setQuestionStartedNow() {
    app.state.questionStartedAt = Date.now()
  }

  function getQuestionElapsedMs() {
    return app.state.questionStartedAt ? Math.max(Date.now() - app.state.questionStartedAt, 0) : null
  }

  function activeRevealState(question) {
    const revealState = activeWordState().revealState
    if (!revealState || !question) return null
    return revealState.itemId === question.id ? revealState : null
  }

  function makeWordRoundQuestions(list, startCursor) {
    const safeList = Array.isArray(list) ? list : []
    if (!safeList.length) return []
    const out = []
    for (let index = 0; index < Math.min(QUIZ_SIZE, safeList.length); index += 1) {
      out.push(safeList[(startCursor + index) % safeList.length])
    }
    return out
  }

  function resolveItemById(id, items) {
    return (Array.isArray(items) ? items : []).find((item) => item.id === id) ?? null
  }

  function startWord(resetCursor) {
    resetTransientState()
    const state = activeWordState()
    const list = currentWordList()
    if (state.mode === "quiz") {
      if (resetCursor || !state.roundQuestions.length || state.roundComplete) {
        state.deckCursor = !list.length || resetCursor ? 0 : clampCursor(state.deckCursor, list.length)
        state.roundQuestions = makeWordRoundQuestions(list, state.deckCursor)
        state.roundIndex = 0
        state.quizRound = []
        state.roundComplete = false
      } else {
        state.roundIndex = clampCursor(state.roundIndex, state.roundQuestions.length || 1)
      }
    } else {
      state.deckCursor = !list.length || resetCursor ? 0 : clampCursor(state.deckCursor, list.length)
      state.roundQuestions = []
      state.roundIndex = 0
      state.quizRound = []
      state.roundComplete = false
    }
    const question = currentWordQuestion()
    if (!question || activeRevealState(question) == null) state.revealState = null
    saveState()
    if (question) setQuestionStartedNow()
    render()
  }

  function startSynonym(resetCursor) {
    resetTransientState()
    const state = activeSynonymState()
    const list = currentSynonymList()
    state.deckCursor = !list.length || resetCursor ? 0 : clampCursor(state.deckCursor, list.length)
    saveState()
    if (currentSynonymQuestion()) setQuestionStartedNow()
    render()
  }

  function restartActive(resetCursor = true) {
    if (app.state.practiceModule === "synonym") {
      startSynonym(resetCursor)
    } else {
      startWord(resetCursor)
    }
  }

  function setDomain(domain) {
    if (domain !== "reading" && domain !== "listening") return
    app.state.domain = domain
    restartActive(false)
  }

  function setPracticeModule(moduleKey) {
    if (moduleKey !== "word" && moduleKey !== "synonym") return
    app.state.practiceModule = moduleKey
    restartActive(false)
  }

  function updateWordControl(field, value) {
    const state = activeWordState()
    if (field === "scene") state.scene = value
    if (field === "mode") state.mode = value === "quiz" ? "quiz" : "drill"
    if (field === "reviewMode") state.reviewMode = value === "mistakes" ? "mistakes" : "all"
    state.revealState = null
    startWord(true)
  }

  function updateSynonymControl(field, value) {
    const state = activeSynonymState()
    if (field === "synonymMode") {
      state.mode = value === "choice" || value === "input" ? value : "mixed"
    }
    if (field === "synonymReviewMode") {
      state.reviewMode = value === "mistakes" ? "mistakes" : "all"
    }
    startSynonym(true)
  }

  function setFeedback(feedback) {
    app.state.feedback = feedback
  }

  function submitWordAnswer() {
    const state = activeWordState()
    const question = currentWordQuestion()
    if (!question) return
    const elapsedMs = getQuestionElapsedMs()
    const verdict = judgeAnswer(question.english, app.state.answerValue)
    const revealState = activeRevealState(question)
    if (revealState?.needsRetype && !verdict.isCorrect) {
      setFeedback({
        type: "retype",
        message: "看过答案后需要把正确拼写完整输入出来，才能进入下一题。",
      })
      render()
      return
    }

    state.answered += 1
    if (elapsedMs != null) {
      state.totalResponseMs += elapsedMs
      state.timedAnswers += 1
    }

    if (verdict.isCorrect) {
      state.correct += 1
      state.streak += 1
    } else {
      state.streak = 0
      state.mistakes = addMistake(state.mistakes, question.id)
    }

    setFeedback({
      type: verdict.isCorrect ? "correct" : "incorrect",
      expected: question.english,
      input: app.state.answerValue,
      chinese: question.chinese,
      elapsedMs,
      firstMismatchTokenIndex: verdict.firstMismatchTokenIndex,
    })

    if (state.mode === "quiz") {
      state.quizRound.push({ itemId: question.id, isCorrect: verdict.isCorrect })
      state.roundIndex += 1
      state.revealState = null
      if (state.roundIndex >= state.roundQuestions.length) {
        state.roundComplete = true
        state.lastQuizSummary = summarizeQuizRound(state.quizRound)
        state.mistakes = state.lastQuizSummary.wrongIds.reduce(addMistake, state.mistakes)
      }
    } else {
      state.revealState = null
      const list = currentWordList()
      if (list.length) state.deckCursor = (clampCursor(state.deckCursor, list.length) + 1) % list.length
    }

    app.state.answerValue = ""
    saveState()
    if (currentWordQuestion()) setQuestionStartedNow()
    render()
  }

  function revealWordAnswer() {
    const state = activeWordState()
    const question = currentWordQuestion()
    if (!question) return
    state.mistakes = addMistake(state.mistakes, question.id)
    state.revealState = createRevealState(question)
    app.state.answerValue = ""
    setFeedback({
      type: "reveal",
      expected: question.english,
      chinese: question.chinese,
    })
    saveState()
    render()
  }

  function submitSynonymInput() {
    const state = activeSynonymState()
    const question = currentSynonymQuestion()
    if (!question) return
    const elapsedMs = getQuestionElapsedMs()
    const verdict = judgeAnswer(question.answer, app.state.answerValue)
    state.answered += 1
    if (elapsedMs != null) {
      state.totalResponseMs += elapsedMs
      state.timedAnswers += 1
    }
    if (verdict.isCorrect) {
      state.correct += 1
    } else {
      state.mistakes = addMistake(state.mistakes, question.id)
    }
    setFeedback({
      type: verdict.isCorrect ? "correct" : "incorrect",
      expected: question.answer,
      input: app.state.answerValue,
      chinese: question.chinese,
      elapsedMs,
      firstMismatchTokenIndex: verdict.firstMismatchTokenIndex,
      prompt: question.prompt,
    })
    const list = currentSynonymList()
    if (list.length) state.deckCursor = (clampCursor(state.deckCursor, list.length) + 1) % list.length
    app.state.answerValue = ""
    saveState()
    if (currentSynonymQuestion()) setQuestionStartedNow()
    render()
  }

  function submitSynonymChoice(value) {
    const state = activeSynonymState()
    const question = currentSynonymQuestion()
    if (!question) return
    const elapsedMs = getQuestionElapsedMs()
    const verdict = judgeAnswer(question.answer, value)
    state.answered += 1
    if (elapsedMs != null) {
      state.totalResponseMs += elapsedMs
      state.timedAnswers += 1
    }
    if (verdict.isCorrect) {
      state.correct += 1
    } else {
      state.mistakes = addMistake(state.mistakes, question.id)
    }
    setFeedback({
      type: verdict.isCorrect ? "correct" : "incorrect",
      expected: question.answer,
      input: value,
      chinese: question.chinese,
      elapsedMs,
      firstMismatchTokenIndex: verdict.firstMismatchTokenIndex,
      prompt: question.prompt,
    })
    const list = currentSynonymList()
    if (list.length) state.deckCursor = (clampCursor(state.deckCursor, list.length) + 1) % list.length
    saveState()
    if (currentSynonymQuestion()) setQuestionStartedNow()
    render()
  }

  function renderFeedback(feedback) {
    if (!feedback) return ""
    if (feedback.type === "reveal") {
      return `<div class="feedback warning"><p class="feedback-title">已显示答案</p><p class="feedback-body">标准答案：${esc(feedback.expected)}；中文提示：${esc(feedback.chinese)}。现在需要你自己重新正确输入一遍，才能进入下一题。</p></div>`
    }
    if (feedback.type === "retype") {
      return `<div class="feedback warning"><p class="feedback-title">需要重输</p><p class="feedback-body">${esc(feedback.message)}</p></div>`
    }
    const className = feedback.type === "correct" ? "success" : "danger"
    const title = feedback.type === "correct" ? "回答正确" : "回答错误"
    const mismatch =
      feedback.firstMismatchTokenIndex >= 0 ? `；从第 ${feedback.firstMismatchTokenIndex + 1} 个词开始出现差异` : ""
    const elapsed = feedback.elapsedMs != null ? `；用时：${formatMs(feedback.elapsedMs)}` : ""
    const prompt = feedback.prompt ? `原词：${feedback.prompt}；` : ""
    return `<div class="feedback ${className}"><p class="feedback-title">${esc(title)}</p><p class="feedback-body">${esc(prompt)}标准答案：${esc(feedback.expected)}；中文解释：${esc(feedback.chinese)}${feedback.input ? `；你的答案：${esc(feedback.input)}` : ""}${esc(mismatch)}${esc(elapsed)}</p></div>`
  }

  function renderTabs() {
    const domainMeta = currentDomainMeta()
    return `
      <div class="tab-row">
        <button class="tab-button${app.state.domain === "listening" ? " tab-button-active" : ""}" type="button" data-action="set-domain" data-value="listening">听力模块</button>
        <button class="tab-button${app.state.domain === "reading" ? " tab-button-active" : ""}" type="button" data-action="set-domain" data-value="reading">阅读模块</button>
      </div>
      <div class="tab-row">
        <button class="tab-button${app.state.practiceModule === "word" ? " tab-button-active" : ""}" type="button" data-action="set-module" data-value="word">${esc(domainMeta.wordLabel)}</button>
        <button class="tab-button${app.state.practiceModule === "synonym" ? " tab-button-active" : ""}" type="button" data-action="set-module" data-value="synonym">${esc(domainMeta.synonymLabel)}</button>
      </div>
    `
  }

  function renderControls() {
    const wordState = activeWordState()
    const synonymState = activeSynonymState()
    const domainMeta = currentDomainMeta()
    const tabs = renderTabs()
    if (app.state.practiceModule === "synonym") {
      return `
        ${tabs}
        <div class="control-grid control-grid-wide">
          <label class="control-group">
            <span class="control-label">题型</span>
            <select class="control-select" data-control="synonymMode">
              <option value="choice"${synonymState.mode === "choice" ? " selected" : ""}>选择题</option>
              <option value="input"${synonymState.mode === "input" ? " selected" : ""}>输入题</option>
              <option value="mixed"${synonymState.mode === "mixed" ? " selected" : ""}>混合模式</option>
            </select>
          </label>
          <label class="control-group">
            <span class="control-label">范围</span>
            <select class="control-select" data-control="synonymReviewMode">
              <option value="all"${synonymState.reviewMode === "all" ? " selected" : ""}>全部题目</option>
              <option value="mistakes"${synonymState.reviewMode === "mistakes" ? " selected" : ""}>错题复习</option>
            </select>
          </label>
          <div class="control-note muted-copy">${esc(domainMeta.synonymNote)}</div>
        </div>
      `
    }
    return `
      ${tabs}
      <div class="control-grid control-grid-wide">
        <label class="control-group">
          <span class="control-label">${esc(domainMeta.wordFilterLabel)}</span>
          <select class="control-select" data-control="scene">
            ${sceneOptions()
              .map(
                (scene) =>
                  `<option value="${esc(scene.value)}"${scene.value === wordState.scene ? " selected" : ""}>${esc(scene.label)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="control-group">
          <span class="control-label">模式</span>
          <select class="control-select" data-control="mode">
            <option value="drill"${wordState.mode === "drill" ? " selected" : ""}>逐词练习</option>
            <option value="quiz"${wordState.mode === "quiz" ? " selected" : ""}>小测模式</option>
          </select>
        </label>
        <label class="control-group">
          <span class="control-label">范围</span>
          <select class="control-select" data-control="reviewMode">
            <option value="all"${wordState.reviewMode === "all" ? " selected" : ""}>全部题目</option>
            <option value="mistakes"${wordState.reviewMode === "mistakes" ? " selected" : ""}>错题复习</option>
          </select>
        </label>
        <div class="control-note muted-copy">
          ${app.state.domain === "reading" ? "阅读词汇第一版按剑桥册号与 Test 组织，便于你先建立阅读词汇与同义替换之间的联系。" : "听力词汇保留原有的场景筛选、逐词闯关、小测和看答案后重打流程。"}
        </div>
      </div>
    `
  }

  function renderWordPractice() {
    const state = activeWordState()
    const list = currentWordList()
    const question = currentWordQuestion()
    if (!list.length) {
      return `<div class="empty-state"><h3>当前没有可练习的题目</h3><p>${esc(currentDomainMeta().wordFilterEmpty)}</p></div>`
    }
    if (state.mode === "quiz" && state.roundComplete) {
      return `<div class="practice-card"><div class="card-topline"><span class="chip">小测已完成</span><span class="chip">${esc(currentDomainMeta().wordLabel)}</span></div><p class="practice-prompt">本轮小测已经结束，你可以查看右侧总结，或点击重新开始。</p><div class="action-row"><button class="button button-primary" type="button" data-action="restart-word">重新开始</button></div>${renderFeedback(app.state.feedback)}</div>`
    }
    if (!question) {
      return `<div class="empty-state"><h3>当前没有可练习的题目</h3><p>请调整筛选条件后再试。</p></div>`
    }
    const revealState = activeRevealState(question)
    const counter =
      state.mode === "quiz"
        ? `第 ${Math.min(state.roundIndex + 1, state.roundQuestions.length || 1)} 题 / 共 ${state.roundQuestions.length} 题`
        : `第 ${clampCursor(state.deckCursor, list.length) + 1} 题 / 共 ${list.length} 项`
    return `
      <form class="practice-card" data-practice-form>
        <div class="card-topline">
          <span class="chip">${esc(currentDomainMeta().wordLabel)}</span>
          <span class="chip">${esc(wordModeLabel(state.mode))}</span>
          <span class="chip">${esc(counter)}</span>
          ${question.source ? `<span class="chip">${esc(question.source)}</span>` : ""}
        </div>
        <div>
          <p class="practice-label">中文提示</p>
          <p class="practice-prompt">${esc(question.chinese)}</p>
          ${question.category ? `<p class="practice-note">分类：${esc(question.category)}</p>` : ""}
        </div>
        <div class="question-meta">
          <span>${esc(currentDomainMeta().wordFilterLabel)}：${esc(sceneOptions().find((item) => item.value === state.scene)?.label ?? "全部题目")}</span>
          ${question.source ? `<span>来源：${esc(question.source)}</span>` : ""}
        </div>
        <label class="control-group">
          <span class="control-label">请输入英文</span>
          <input class="answer-input" data-answer-input autocomplete="off" spellcheck="false" value="${esc(app.state.answerValue)}" placeholder="输入完整英文拼写" />
        </label>
        <div class="action-row">
          <button class="button button-primary" type="submit">提交答案</button>
          <button class="button button-secondary" type="button" data-action="reveal-word"${revealState ? " disabled" : ""}>看答案</button>
          <button class="button button-secondary" type="button" data-action="restart-word">重新开始</button>
        </div>
        ${renderFeedback(app.state.feedback)}
      </form>
    `
  }

  function renderSynonymPractice() {
    const state = activeSynonymState()
    const list = currentSynonymList()
    const question = currentSynonymQuestion()
    if (!list.length) {
      return `<div class="empty-state"><h3>当前没有可练习的同义替换</h3><p>请切回全部题目，或先积累一些错题。</p></div>`
    }
    if (!question) {
      return `<div class="empty-state"><h3>当前没有可练习的同义替换</h3><p>请调整筛选条件后再试。</p></div>`
    }
    const questionType = currentSynonymQuestionType()
    const counter = `第 ${clampCursor(state.deckCursor, list.length) + 1} 题 / 共 ${list.length} 项`
    return `
      <form class="practice-card" data-practice-form>
        <div class="card-topline">
          <span class="chip">${esc(currentDomainMeta().synonymLabel)}</span>
          <span class="chip">${esc(synonymModeLabel(questionType))}</span>
          <span class="chip">${esc(counter)}</span>
          <span class="chip">${esc(question.source)}</span>
        </div>
        <div>
          <p class="practice-label">原词 / 表达</p>
          <p class="practice-prompt">${esc(question.prompt)}</p>
          <p class="practice-note">${esc(question.chinese)}</p>
        </div>
        <div class="question-meta">
          <span>题型：${esc(synonymModeLabel(state.mode))}</span>
          <span>范围：${esc(reviewModeLabel(state.reviewMode))}</span>
        </div>
        ${
          questionType === "choice"
            ? `<div class="choice-grid">${buildChoiceOptions(list, question)
                .map(
                  (choice) =>
                    `<button class="button button-secondary choice-button" type="button" data-action="choose-synonym" data-value="${esc(choice)}">${esc(choice)}</button>`,
                )
                .join("")}</div>`
            : `<label class="control-group"><span class="control-label">请输入替换表达</span><input class="answer-input" data-answer-input autocomplete="off" spellcheck="false" value="${esc(app.state.answerValue)}" placeholder="输入原文里的替换表达" /></label><div class="action-row"><button class="button button-primary" type="submit">提交答案</button><button class="button button-secondary" type="button" data-action="restart-synonym">重新开始</button></div>`
        }
        ${renderFeedback(app.state.feedback)}
      </form>
    `
  }

  function renderPractice() {
    return app.state.practiceModule === "synonym" ? renderSynonymPractice() : renderWordPractice()
  }

  function renderStats() {
    const state = app.state.practiceModule === "synonym" ? activeSynonymState() : activeWordState()
    const correctRate = state.answered ? Math.round((state.correct / state.answered) * 100) : 0
    const average = averageResponseMs(state.totalResponseMs, state.timedAnswers)
    return `
      <div class="stat-grid">
        <div class="stat-card"><p class="stat-label">已答题数</p><p class="stat-value">${state.answered}</p></div>
        <div class="stat-card"><p class="stat-label">正确率</p><p class="stat-value">${correctRate}%</p></div>
        <div class="stat-card"><p class="stat-label">错题数</p><p class="stat-value">${state.mistakes.length}</p></div>
        <div class="stat-card"><p class="stat-label">平均用时</p><p class="stat-value">${formatMs(average)}</p></div>
        ${
          app.state.practiceModule === "word"
            ? `<div class="stat-card"><p class="stat-label">当前连对</p><p class="stat-value">${activeWordState().streak}</p></div>`
            : `<div class="stat-card"><p class="stat-label">当前题型</p><p class="stat-value">${esc(synonymModeLabel(activeSynonymState().mode))}</p></div>`
        }
        <div class="stat-card"><p class="stat-label">当前模块</p><p class="stat-value">${esc(app.state.practiceModule === "word" ? currentDomainMeta().wordLabel : currentDomainMeta().synonymLabel)}</p></div>
      </div>
    `
  }

  function renderMistakeList(items, ids, formatter) {
    if (!ids.length) return `<p class="muted-copy">当前还没有错题记录。</p>`
    const lines = ids
      .map((id) => resolveItemById(id, items))
      .filter(Boolean)
      .slice(0, 30)
      .map((item) => `<li>${formatter(item)}</li>`)
      .join("")
    return `<ol class="list">${lines}</ol>`
  }

  function renderResults() {
    if (app.state.practiceModule === "word") {
      const state = activeWordState()
      const items = currentVocabData()
      return `
        <div class="summary-card">
          <p class="result-label">最近一次小测</p>
          ${
            state.lastQuizSummary
              ? `<div class="summary-stats">
                  <div class="summary-stat"><p class="stat-label">总题数</p><p class="summary-value">${state.lastQuizSummary.total}</p></div>
                  <div class="summary-stat"><p class="stat-label">答对</p><p class="summary-value">${state.lastQuizSummary.correct}</p></div>
                  <div class="summary-stat"><p class="stat-label">答错</p><p class="summary-value">${state.lastQuizSummary.incorrect}</p></div>
                </div>`
              : `<p class="muted-copy">你还没有完成过当前模块的小测。</p>`
          }
        </div>
        <div class="result-card">
          <p class="result-label">错题回顾</p>
          ${renderMistakeList(
            items,
            state.mistakes,
            (item) =>
              `${esc(item.english)} — ${esc(item.chinese)}${item.source ? ` <span class="muted-copy">（${esc(item.source)}）</span>` : ""}`,
          )}
        </div>
      `
    }

    const state = activeSynonymState()
    const items = currentSynonymData()
    return `
      <div class="summary-card">
        <p class="result-label">练习摘要</p>
        <div class="summary-stats">
          <div class="summary-stat"><p class="stat-label">总作答</p><p class="summary-value">${state.answered}</p></div>
          <div class="summary-stat"><p class="stat-label">答对</p><p class="summary-value">${state.correct}</p></div>
          <div class="summary-stat"><p class="stat-label">错题</p><p class="summary-value">${state.mistakes.length}</p></div>
        </div>
      </div>
      <div class="result-card">
        <p class="result-label">错题回顾</p>
        ${renderMistakeList(
          items,
          state.mistakes,
          (item) => `${esc(item.prompt)} → ${esc(item.answer)} — ${esc(item.chinese)} <span class="muted-copy">（${esc(item.source)}）</span>`,
        )}
      </div>
    `
  }

  function renderHeader() {
    const meta = currentDomainMeta()
    const eyebrow = meta.eyebrow
    const summary = meta.summary
    document.title = meta.title
    const eyebrowNode = document.getElementById("site-eyebrow")
    const titleNode = document.getElementById("site-title")
    const summaryNode = document.getElementById("site-summary")
    if (eyebrowNode) eyebrowNode.textContent = eyebrow
    if (titleNode) titleNode.textContent = meta.title
    if (summaryNode) summaryNode.textContent = summary
  }

  function render() {
    if (!app.el) return
    renderHeader()
    app.el.controls.innerHTML = renderControls()
    app.el.practice.innerHTML = renderPractice()
    app.el.stats.innerHTML = renderStats()
    app.el.results.innerHTML = renderResults()
    const input = app.el.practice.querySelector("[data-answer-input]")
    if (input) input.focus()
  }

  function onInput(event) {
    const target = event.target
    if (!target?.hasAttribute?.("data-answer-input")) return
    app.state.answerValue = target.value
  }

  function onSubmit(event) {
    if (!event.target?.closest?.("[data-practice-form]")) return
    event.preventDefault()
    if (app.state.practiceModule === "synonym" && currentSynonymQuestionType() === "choice") return
    if (app.state.practiceModule === "synonym") {
      submitSynonymInput()
    } else {
      submitWordAnswer()
    }
  }

  function onClick(event) {
    const button = event.target?.closest?.("[data-action]")
    if (!button) return
    event.preventDefault()
    const action = button.getAttribute("data-action")
    const value = button.getAttribute("data-value")
    if (action === "set-domain") return setDomain(value)
    if (action === "set-module") return setPracticeModule(value)
    if (action === "reveal-word") return revealWordAnswer()
    if (action === "restart-word") return startWord(true)
    if (action === "restart-synonym") return startSynonym(true)
    if (action === "choose-synonym") return submitSynonymChoice(value)
  }

  function onChange(event) {
    const target = event.target
    const control = target?.getAttribute?.("data-control")
    if (!control) return
    if (control === "scene" || control === "mode" || control === "reviewMode") {
      return updateWordControl(control, target.value)
    }
    if (control === "synonymMode" || control === "synonymReviewMode") {
      return updateSynonymControl(control, target.value)
    }
  }

  function mount() {
    app.el = {
      controls: document.querySelector('[data-mount="controls"]'),
      practice: document.querySelector('[data-mount="practice"]'),
      stats: document.querySelector('[data-mount="stats"]'),
      results: document.querySelector('[data-mount="results"]'),
    }
    if (Object.values(app.el).some((node) => !node)) return
    app.el.controls.addEventListener("change", onChange)
    app.el.controls.addEventListener("click", onClick)
    app.el.practice.addEventListener("input", onInput)
    app.el.practice.addEventListener("submit", onSubmit)
    app.el.practice.addEventListener("click", onClick)
    app.state = loadState()
    app.ready = true
    restartActive(false)
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true })
  } else {
    mount()
  }
})(typeof window !== "undefined" ? window : globalThis)
