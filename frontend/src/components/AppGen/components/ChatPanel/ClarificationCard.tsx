import { useState } from 'react'
import { HelpCircle, Check, CheckCircle } from 'lucide-react'
import type { ClarificationQuestion } from '../../hooks/useChat'
import type { ClarificationAnswerV2, ClarificationResponseV2 } from '../../lib/api'
import { DEFAULT_FREE_TEXT_PLACEHOLDER } from './constants'
import { cleanInlineText, formatOptionLabel } from './utils'
import styles from './ClarificationCard.module.css'

interface ClarificationCardProps {
  clarificationId: string
  questions: ClarificationQuestion[]
  /** Submitted answers so read-only view can show what was selected. */
  submittedAnswers?: ClarificationAnswerV2[]
  onSubmit: (response: ClarificationResponseV2) => void
  /** When false, card is read-only (e.g. from history or already submitted). No selection or submit. */
  isActive?: boolean
  disabled?: boolean
}

export function ClarificationCard({
  clarificationId,
  questions,
  submittedAnswers = [],
  onSubmit,
  isActive = true,
  disabled = false,
}: ClarificationCardProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [freeText, setFreeText] = useState<Record<string, string>>({})
  const [skipped, setSkipped] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)

  const handleSelect = (
    questionId: string,
    mode: 'single_choice' | 'multi_choice',
    key: string
  ) => {
    if (submitted || disabled || !isActive) return
    setSkipped((prev) => ({ ...prev, [questionId]: false }))
    setSelections((prev) => {
      const current = prev[questionId] ?? []
      if (mode === 'single_choice') {
        return { ...prev, [questionId]: [key] }
      }
      const exists = current.includes(key)
      const next = exists ? current.filter((k) => k !== key) : [...current, key]
      return { ...prev, [questionId]: next }
    })
  }

  const handleSkip = (questionId: string) => {
    if (submitted || disabled || !isActive) return
    setSkipped((prev) => ({ ...prev, [questionId]: true }))
    setSelections((prev) => ({ ...prev, [questionId]: [] }))
  }

  const isAnswered = (q: ClarificationQuestion): boolean => {
    const qid = q.id
    if (skipped[qid]) return true
    const selected = selections[qid] ?? []
    const text = (freeText[qid] ?? '').trim()
    const minSelect = Math.max(0, q.min_select ?? 1)
    if (selected.length >= minSelect) return true
    if ((q.allow_free_text ?? false) && text.length > 0) return true
    return false
  }

  const allAnswered = questions.every((q) => isAnswered(q))

  const handleSubmit = () => {
    if (!allAnswered || submitted || disabled || !isActive) return
    const answers = questions.map((q) => ({
      question_id: q.id,
      selected_option_keys: selections[q.id] ?? [],
      free_text: (freeText[q.id] ?? '').trim() || undefined,
      skipped: !!skipped[q.id],
    }))
    setSubmitted(true)
    onSubmit({
      clarification_id: clarificationId,
      answers,
    })
  }

  const answeredCount = questions.filter((q) => isAnswered(q)).length

  if (!isActive) {
    const getSelectedKeys = (questionId: string): string[] =>
      submittedAnswers.find((a) => a.question_id === questionId)?.selected_option_keys ?? []
    const getAnswer = (questionId: string): ClarificationAnswerV2 | undefined =>
      submittedAnswers.find((a) => a.question_id === questionId)

    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <HelpCircle className={styles.headerIcon} aria-hidden />
          <span className={styles.headerText}>
            Before I start building, I need a few details
          </span>
        </div>
        <div className={styles.questions}>
          {questions.map((q, qIdx) => {
            const qid = q.id || `q_${qIdx}`
            const modeLabel =
              q.selection_mode === 'multi_choice' ? 'Multi-select' : 'Single-select'
            const selectedKeys = getSelectedKeys(qid)
            const answer = getAnswer(qid)
            const wasSkipped = answer?.skipped === true
            const freeText = (answer?.free_text ?? '').trim()

            return (
              <div key={qid} className={styles.questionBlock}>
                <div className={styles.questionHead}>
                  <span className={styles.questionNumber} aria-hidden>
                    {qIdx + 1}
                  </span>
                  <span className={styles.questionTitle}>{cleanInlineText(q.text)}</span>
                  <span className={styles.modePill}>{modeLabel}</span>
                </div>
                {wasSkipped ? (
                  <div className={styles.readOnlySkipped}>Skipped</div>
                ) : (
                  <ul className={styles.readOnlyOptions} aria-label={`Selected: ${selectedKeys.length ? selectedKeys.join(', ') : 'none'}`}>
                    {q.options.map((opt) => {
                      const isSelected = selectedKeys.includes(opt.key)
                      const optionLabel = formatOptionLabel(opt.value, opt.key)
                      const optionDescription = cleanInlineText(opt.description ?? '')
                      return (
                        <li
                          key={opt.key}
                          className={`${styles.readOnlyOptionRow} ${isSelected ? styles.readOnlyOptionSelected : ''}`}
                        >
                          <span className={styles.optionCheck}>
                            {q.selection_mode === 'multi_choice' ? (
                              <span className={isSelected ? styles.checkboxChecked : styles.checkbox}>
                                {isSelected && <Check className={styles.checkIcon} aria-hidden />}
                              </span>
                            ) : (
                              <span className={isSelected ? styles.radioChecked : styles.radio} />
                            )}
                          </span>
                          <span className={styles.optionContent}>
                            <span className={styles.optionLabel}>{optionLabel}</span>
                            {optionDescription && (
                              <span className={styles.optionDescription}>
                                {optionDescription}
                              </span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {freeText && (
                  <div className={styles.readOnlyFreeText}>
                    <span className={styles.readOnlyFreeTextLabel}>Your answer: </span>
                    {freeText}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className={styles.footer}>
          <div className={styles.submittedMessage}>
            <CheckCircle className={styles.submittedIcon} aria-hidden />
            <span>Already submitted</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <HelpCircle className={styles.headerIcon} aria-hidden />
        <span className={styles.headerText}>
          Before I start building, I need a few details
        </span>
      </div>

      <div className={styles.questions}>
        {questions.map((q, qIdx) => {
          const qid = q.id || `q_${qIdx}`
          const modeLabel =
            q.selection_mode === 'multi_choice' ? 'Multi-select' : 'Single-select'
          return (
            <fieldset key={qid} className={styles.questionBlock}>
              <div className={styles.questionHead}>
                <span className={styles.questionNumber} aria-hidden>
                  {qIdx + 1}
                </span>
                <legend className={styles.questionTitle}>{cleanInlineText(q.text)}</legend>
                <span className={styles.modePill}>{modeLabel}</span>
              </div>
              <div className={styles.options} role={q.selection_mode === 'multi_choice' ? 'group' : 'radiogroup'} aria-label={q.text}>
                {q.options.map((opt) => {
                  const selectedKeys = selections[qid] ?? []
                  const isSelected = selectedKeys.includes(opt.key)
                  const optionLabel = formatOptionLabel(opt.value, opt.key)
                  const optionDescription = cleanInlineText(opt.description ?? '')
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      role={q.selection_mode === 'multi_choice' ? 'checkbox' : 'radio'}
                      aria-checked={isSelected}
                      onClick={() =>
                        handleSelect(qid, q.selection_mode, opt.key)
                      }
                      disabled={submitted || disabled}
                      className={`${styles.option} ${isSelected ? styles.optionSelected : ''} ${submitted || disabled ? styles.optionDisabled : ''}`}
                    >
                      <span className={styles.optionCheck}>
                        {q.selection_mode === 'multi_choice' ? (
                          <span className={isSelected ? styles.checkboxChecked : styles.checkbox}>
                            {isSelected && <Check className={styles.checkIcon} aria-hidden />}
                          </span>
                        ) : (
                          <span className={isSelected ? styles.radioChecked : styles.radio} />
                        )}
                      </span>
                      <span className={styles.optionContent}>
                        <span className={styles.optionLabel}>{optionLabel}</span>
                        {optionDescription && (
                          <span className={styles.optionDescription}>
                            {optionDescription}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
                {q.allow_skip && (
                  <button
                    type="button"
                    onClick={() => handleSkip(qid)}
                    disabled={submitted || disabled}
                    className={styles.skipBtn}
                  >
                    Skip
                  </button>
                )}
              </div>
              {q.allow_free_text && (
                <div className={styles.freeTextWrap}>
                  <input
                    type="text"
                    value={freeText[qid] ?? ''}
                    onChange={(e) =>
                      setFreeText((prev) => ({ ...prev, [qid]: e.target.value }))
                    }
                    disabled={submitted || disabled}
                    placeholder={
                      cleanInlineText(q.placeholder ?? '') ||
                      DEFAULT_FREE_TEXT_PLACEHOLDER
                    }
                    className={styles.freeTextInput}
                    aria-label={`Other answer for: ${q.text}`}
                  />
                </div>
              )}
            </fieldset>
          )
        })}
      </div>

      <div className={styles.footer}>
        {submitted ? (
          <div className={styles.submittedMessage}>
            <CheckCircle className={styles.submittedIcon} aria-hidden />
            <span>Answers submitted — building now…</span>
          </div>
        ) : (
          <>
            <span className={styles.progress}>
              {allAnswered
                ? 'Ready to submit'
                : `${answeredCount} of ${questions.length} answered`}
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!allAnswered || disabled}
              className={`${styles.submitBtn} ${allAnswered && !disabled ? styles.submitBtnActive : ''}`}
            >
              Submit answers
            </button>
          </>
        )}
      </div>
    </div>
  )
}
