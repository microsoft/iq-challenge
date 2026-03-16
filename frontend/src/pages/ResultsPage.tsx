import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import { useGame } from '../context/GameContext'
import { gameConfig } from '../config/gameConfig'
import { analytics } from '../services/analyticsService'
import QRCode from 'react-qr-code'

interface StatDescriptor {
  label: string
  value: string
  helper?: string
}

function formatDuration(totalSeconds: number): string {
  const safeValue = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(safeValue / 60)
  const seconds = safeValue % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function formatHeartsValue(totalHearts: number): string {
  const safeValue = Math.max(0, totalHearts)
  return Number.isInteger(safeValue) ? safeValue.toFixed(0) : safeValue.toFixed(1)
}

function StatGroup({ title, stats, caption }: { title: string; stats: StatDescriptor[]; caption?: string }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]">
      <header className="border-b border-white/10 px-7 py-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">{title}</p>
        {caption ? <p className="mt-2 text-sm text-white/45">{caption}</p> : null}
      </header>
      <ul className="divide-y divide-white/8">
        {stats.map((stat) => (
          <li key={stat.label} className="flex items-center justify-between px-7 py-6">
            <div>
              <p className="text-sm font-medium text-white/70">{stat.label}</p>
              {stat.helper ? <p className="mt-1 text-xs text-white/45">{stat.helper}</p> : null}
            </div>
            <span className="text-xl font-semibold text-white">{stat.value}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const QR_LINKS_DEFAULT = [
  {
    id: 'leaderboard',
    title: 'View the Leaderboard',
    href: 'https://aka.ms/fabrictrivia/l',
    description: 'See how your high score compares to other challengers.',
  },
  {
    id: 'learn-fabric',
    title: 'Learn More About Fabric',
    href: 'https://aka.ms/fabrictrivia/f',
    description: 'Discover tutorials, case studies, and product highlights.',
  },
  {
    id: 'get-certified',
    title: 'Get Certified',
    href: 'https://aka.ms/fabrictrivia/c',
    description: 'Take the next step with Fabric certifications and training.',
  },
] as const

const QR_LINKS_SQL_OVERRIDE = {
  id: 'get-certified',
  title: 'Take the next step with SQL certifications and training.',
  href: 'https://aka.ms/AzureSQLAIDevelopment',
  description: 'Take the next step with SQL certifications and training.',
} as const

export default function ResultsPage() {
  const navigate = useNavigate()
  const {
    player,
    session,
    score,
    questionsAnswered,
    correctAnswers,
    streaksCompleted,
    timeLeft,
    maxTime,
    hearts,
    gameOverReason,
    missedQuestions,
    resetGame,
    selectedPool,
  } = useGame()

  const [analyticsEventCount] = useState(() => analytics.getTrackedEventCount())

  const qrLinks = useMemo(() => {
    if (selectedPool?.id === 'sql') {
      return [...QR_LINKS_DEFAULT.slice(0, 2), QR_LINKS_SQL_OVERRIDE]
    }
    return QR_LINKS_DEFAULT
  }, [selectedPool])

  useEffect(() => {
    if (!player) {
      navigate('/signin', { replace: true })
    }
  }, [player, navigate])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const baseTime = gameConfig.timer.initialSeconds
  const totalTimeBudget = Math.max(baseTime, maxTime)
  const bonusSecondsEarned = Math.max(0, totalTimeBudget - baseTime)
  const answered = Math.max(0, questionsAnswered)
  const correct = Math.max(0, correctAnswers)
  const incorrect = Math.max(0, answered - correct)
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0
  const timeRemaining = Math.max(0, timeLeft)
  const timeSpent = Math.max(0, totalTimeBudget - timeRemaining)
  const completedStreaksDisplay = Math.min(streaksCompleted, gameConfig.timer.maxStreaks)
  const heartsRemaining = Math.max(0, hearts)
  const heartsDepleted = heartsRemaining <= 0 || gameOverReason === 'hearts.depleted'

  const formattedScore = useMemo(() => new Intl.NumberFormat().format(score), [score])
  const performanceStats = useMemo<StatDescriptor[]>(
    () => [
      {
        label: 'Questions Answered',
        value: answered.toString(),
        helper: `${correct} correct · ${incorrect} incorrect`,
      },
      {
        label: 'Accuracy',
        value: `${accuracy}%`,
        helper: answered > 0 ? `${correct}/${answered} answered correctly` : 'No answers submitted',
      },
      {
        label: 'Final Score',
        value: formattedScore,
        helper: 'Includes base points and streak bonuses',
      },
      {
        label: 'Streaks Completed',
        value: completedStreaksDisplay.toString(),
        helper: `+${completedStreaksDisplay * gameConfig.timer.bonusSeconds}s bonus time earned`,
      },
      {
        label: 'Hearts Remaining',
        value: `${formatHeartsValue(heartsRemaining)} / ${formatHeartsValue(gameConfig.hearts.initialCount)}`,
        helper: heartsDepleted ? 'All hearts were spent this run' : 'Wrong answers cost 0.5 hearts',
      },
    ],
    [answered, accuracy, correct, incorrect, formattedScore, completedStreaksDisplay, heartsRemaining, heartsDepleted]
  )

  const timeStats = useMemo<StatDescriptor[]>(() => {
    const averagePerQuestion = answered > 0 ? `${formatDuration(timeSpent / answered)}/question` : '—'
    const paceHelper = answered > 0 ? 'Average response time per question' : 'Play again to record a pace'

    return [
      {
        label: 'Total Time Budget',
        value: formatDuration(totalTimeBudget),
        helper: `${baseTime}s base · +${bonusSecondsEarned}s bonus`,
      },
      {
        label: 'Bonus Time Earned',
        value: `+${bonusSecondsEarned}s`,
        helper:
          completedStreaksDisplay > 0
            ? `${completedStreaksDisplay} completed streak${completedStreaksDisplay === 1 ? '' : 's'} kept the clock on your side`
            : 'Rack up streaks to unlock extra time',
      },
      {
        label: 'Average Pace',
        value: averagePerQuestion,
        helper: paceHelper,
      },
    ]
  }, [answered, baseTime, bonusSecondsEarned, completedStreaksDisplay, timeSpent, totalTimeBudget])

  const sessionStats = useMemo<StatDescriptor[]>(
    () => {
      const startedAt = session ? new Date(session.startTime) : null
      return [
        {
          label: 'Session ID',
          value: session?.sessionId ?? 'Unavailable',
          helper: 'Share this code with the Fabric team if you need support',
        },
        {
          label: 'Start Time',
          value: startedAt ? startedAt.toLocaleString() : '—',
          helper: 'Local time when your run began',
        },
        {
          label: 'Question Seed',
          value: session ? String(session.seed) : '—',
          helper: 'Ensures identical question order for analytics',
        },
        {
          label: 'Telemetry Events',
          value: analyticsEventCount.toString(),
          helper: 'Total analytics events emitted during this run',
        },
      ]
    },
    [session, analyticsEventCount]
  )

  const playerName = (player?.name ?? '').trim()
  const playerFirstName = playerName.split(/\s+/)[0] || player?.name || 'Player'
  const playerDisplayName = playerName || player?.name || 'Player'
  const sessionTag = session?.sessionId ? session.sessionId.slice(0, 8).toUpperCase() : '--------'
  const failedQuestions = missedQuestions
  const hasFailedQuestions = failedQuestions.length > 0

  const accuracyFeedback = useMemo(() => {
    if (accuracy >= 95) {
      return {
        title: `Legendary accuracy, ${playerFirstName}!`,
        message: 'Every tap landed perfectly. The leaderboard should be nervous about your next run.',
      }
    }

    if (accuracy >= 85) {
      return {
        title: `Elite run, ${playerFirstName}.`,
        message: 'You read the board like a pro and kept the streak meter glowing. Another game could put you on top.',
      }
    }

    if (accuracy >= 70) {
      return {
        title: `Great rhythm, ${playerFirstName}!`,
        message: 'Smart calls and solid pace—one more push and those streak bonuses are yours for the taking.',
      }
    }

    if (accuracy >= 50) {
      return {
        title: `Solid hustle, ${playerFirstName}.`,
        message: 'You kept the momentum alive. Sharpen a couple answers and you will turbocharge your score.',
      }
    }

    return {
      title: `Bold effort, ${playerFirstName}!`,
      message: 'You kept swinging and learned the terrain. Queue up another round and turn those insights into streaks.',
    }
  }, [accuracy, playerFirstName])

  const heartsFeedback = useMemo(
    () => ({
      title: `Sorry, ${playerFirstName}.`,
      message: 'You ran out of hearts 💔. Review the questions you missed and jump back in for another run.',
    }),
    [playerFirstName]
  )

  const heroFeedback = heartsDepleted ? heartsFeedback : accuracyFeedback
  const resultBadgeLabel = heartsDepleted ? 'Game Over' : 'Quest Complete'

  const handlePlayAgain = useCallback(() => {
    resetGame()
    navigate('/', { replace: true })
  }, [navigate, resetGame])

  if (!player) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#040406] text-white">
        <p className="text-sm text-white/60">Redirecting to sign in…</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040406] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#1f2937_0%,#040406_70%)]" aria-hidden="true" />
        <div className="absolute -top-44 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-amber-400/25 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-sky-400/15 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-40 -right-28 h-80 w-80 rounded-full bg-purple-500/15 blur-3xl" aria-hidden="true" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 pt-10">
    <Header userName={player.name} />

        <main className="mt-6 flex-1">
          <section className="relative overflow-hidden rounded-[34px] border border-amber-200/20 bg-white/5 p-[1.5px] shadow-[0_32px_64px_rgba(0,0,0,0.65)] backdrop-blur-sm">
            <div className="relative rounded-[30px] bg-neutral-950/85 px-8 pb-12 pt-14">
              <div
                className="pointer-events-none absolute left-1/2 top-0 h-72 w-[130%] -translate-x-1/2 -translate-y-[42%] bg-[radial-gradient(ellipse_at_center,rgba(255,208,120,0.38)_0%,rgba(17,17,17,0.75)_52%,rgba(17,17,17,0)_78%)]"
                aria-hidden="true"
              />

              <div className="relative flex flex-col items-center text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.4em] text-amber-200/70">{resultBadgeLabel}</p>
                <h1 className="mt-6 text-3xl font-semibold text-white md:text-4xl">{heroFeedback.title}</h1>
                <p className="mt-3 max-w-2xl text-sm text-white/70 md:text-base">{heroFeedback.message}</p>

                <div className="mt-10 w-full max-w-2xl rounded-3xl border border-amber-200/30 bg-black/40 px-8 py-9 text-left shadow-[0_18px_48px_rgba(0,0,0,0.45)]">
                  <div className="flex flex-col items-center gap-6 text-center md:flex-row md:items-center md:justify-between md:text-left">
                    <div>
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.38em] text-amber-200/70">Player</p>
                      <p className="mt-2 text-2xl font-semibold text-white md:text-3xl">{playerDisplayName}</p>
                    </div>
                    <div className="flex flex-col items-center rounded-2xl border border-amber-200/40 bg-amber-300/15 px-5 py-3 text-center shadow-[0_18px_42px_rgba(251,191,36,0.28)]">
                      <p className="text-[0.55rem] font-semibold uppercase tracking-[0.4em] text-amber-100/80">Session</p>
                      <p className="mt-1 font-mono text-lg font-semibold text-amber-100">{sessionTag}</p>
                    </div>
                  </div>

                  <div className="mt-8 flex flex-col items-center text-center">
                    <span className="text-sm uppercase tracking-[0.35em] text-white/65">Final Score</span>
                    <p className="mt-4 text-6xl font-black text-amber-300 drop-shadow-[0_20px_35px_rgba(217,119,6,0.45)] md:text-7xl">
                      {formattedScore}
                    </p>
                    <p className="mt-4 text-base font-medium text-white/70 md:text-lg">
                      Accuracy {accuracy}% · {correct}/{answered} correct answers
                    </p>
                    <p className="mt-1 text-sm text-white/50">
                      {completedStreaksDisplay} completed streak{completedStreaksDisplay === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className="mt-8 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={handlePlayAgain}
                    className="w-full max-w-xs rounded-2xl bg-linear-to-r from-amber-400 via-amber-300 to-amber-500 px-4 py-3.5 text-lg font-semibold text-[#2b1800] shadow-[0_18px_42px_rgba(251,191,36,0.45)] transition hover:brightness-[1.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
                  >
                    Play Again
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-12">
            <div className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]">
              <header className="border-b border-white/10 px-7 py-6">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Keep Exploring</p>
                <p className="mt-2 text-sm text-white/45">Scan a code to keep your Fabric journey going after the challenge.</p>
              </header>
              <div className="grid gap-6 px-7 py-8 md:grid-cols-3">
                {qrLinks.map((link) => (
                    <div
                    key={link.id}
                    className="group flex flex-col items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-6 py-7 text-center transition hover:border-amber-200/70 hover:shadow-[0_18px_42px_rgba(251,191,36,0.35)]"
                    >
                    <div className="rounded-2xl bg-white/5 p-4 shadow-inner" role="img" aria-label={`${link.title} QR code`}>
                      <QRCode value={link.href} size={148} bgColor="transparent" fgColor="#FCD34D" />
                    </div>
                    <div className="mt-6 flex flex-col gap-2">
                      <p className="text-sm font-semibold text-white md:text-base">{link.title}</p>
                      <p className="text-xs text-white/60">{link.description}</p>
                      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">Scan & Go</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>


          <section className="mt-12 grid gap-7 lg:grid-cols-2">
            <StatGroup
              title="Performance Summary"
              caption="Your responses and streaks across this session"
              stats={performanceStats}
            />
            <StatGroup
              title="Time & Momentum"
              caption="How you managed the dynamic timer and streak bonuses"
              stats={timeStats}
            />
          </section>

          <section className="mt-12">
            <div className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]">
              <header className="border-b border-white/10 px-7 py-6">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Missed Questions</p>
                <p className="mt-2 text-sm text-white/45">Review the prompts that tripped you up and study their correct answers.</p>
              </header>
              {hasFailedQuestions ? (
                <ul className="divide-y divide-white/8">
                  {failedQuestions.map((question) => {
                    const correctChoice = question.choices[question.correctAnswerIndex] ?? 'Unavailable'
                    const selectedChoice = question.choices[question.selectedAnswerIndex] ?? 'No answer recorded'
                    return (
                      <li key={question.questionId} className="px-7 py-6">
                        <p className="text-sm font-semibold text-white md:text-base">{question.questionText}</p>
                        <p className="mt-3 text-xs uppercase tracking-[0.3em] text-white/40">{question.category}</p>
                        <div className="mt-4 space-y-1 text-sm">
                          <p className="text-white/65">
                            <span className="text-white/45">Correct Answer:</span>{' '}
                            <span className="font-medium text-emerald-300">{correctChoice}</span>
                          </p>
                          <p className="text-white/65">
                            <span className="text-white/45">Your Answer:</span>{' '}
                            <span className="font-medium text-rose-300">{selectedChoice}</span>
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="px-7 py-8 text-center text-sm text-white/60">
                  Flawless victory — no missed questions this time. Keep the streak alive!
                </div>
              )}
            </div>
          </section>

          
          <section className="mt-12">
            <StatGroup
              title="Session Details"
              caption="Keep these handy for support or bragging rights"
              stats={sessionStats}
            />
          </section>
        </main>
      </div>
    </div>
  )
}
