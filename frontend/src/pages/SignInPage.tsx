import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { useGame } from '../context/GameContext'
import { userService } from '../services/userService'
import { analytics } from '../services/analyticsService'
import { getStationLockdownMessage, isStationLockdownActive } from '../lib/stationLockdown'
import countriesData from '../config/countries.json'

export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setPlayer } = useGame()
  const isLockdownActive = isStationLockdownActive()
  const lockdownMessage = getStationLockdownMessage()
  const [formData, setFormData] = useState({
    playerName: '',
    playerEmail: '',
    playerPhone: '',
    country: '',
    state: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const displayedError = isLockdownActive ? lockdownMessage : error

  useEffect(() => {
    analytics.track('pageview.home', { path: location.pathname })
  }, [location.pathname])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) {
      return
    }

    if (isLockdownActive) {
      setError(lockdownMessage)
      return
    }

    setError(null)

    const name = formData.playerName.trim()
    const email = formData.playerEmail.trim()
    const phone = formData.playerPhone.trim()
    const country = formData.country.trim()
    const state = formData.state.trim()

    if (!name || !email) {
      setError('Please provide both your name and email to continue.')
      return
    }

    if (!country) {
      setError('Please select your country to continue.')
      return
    }

    if (country === 'United States' && !state) {
      setError('Please select your state to continue.')
      return
    }

    setIsSubmitting(true)

    try {
      const user = await userService.register({
        name,
        email,
        ...(phone ? { phoneNumber: phone } : {}),
        ...(country === 'United States' ? { state } : { country }),
      })

      analytics.identify(user)
      analytics.track(
        'user.register',
        {
          userId: user.userId,
          name: user.name,
          hasPhoneNumber: Boolean(phone),
          country,
          state: state || null
        },
        {
          page: 'signin',
        }
      )

      setPlayer(user)
      navigate('/select-pool')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => {
      const next = {
        ...prev,
        [name]: value,
      }

      if (name === 'country' && value !== 'United States') {
        next.state = ''
      }

      return next
    })
  }

  const { countries, states } = countriesData

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040406]">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#1f2937_0%,#040406_70%)]" aria-hidden="true" />
        <div className="absolute -top-48 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-amber-400/25 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-sky-400/15 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-40 -right-28 h-80 w-80 rounded-full bg-purple-500/15 blur-3xl" aria-hidden="true" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg">
          <div className="relative overflow-hidden rounded-[34px] border border-amber-200/20 bg-white/5 p-[1.5px] shadow-[0_32px_64px_rgba(0,0,0,0.65)] backdrop-blur-sm">
            <div className="relative rounded-4xl bg-neutral-950/80 px-9 pb-10 pt-12">
              <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(255,215,128,0.35)_0%,rgba(17,17,17,0)_70%)]" aria-hidden="true" />

              <div className="relative flex flex-col items-center text-center">
                <img
                  src="/fabriclogo.png"
                  alt="Microsoft Fabric"
                  className="mb-6 h-16 w-16 drop-shadow-[0_20px_45px_rgba(255,184,0,0.4)]"
                />
                <h1 className="text-2xl font-semibold text-white md:text-3xl">
                  The Microsoft Fabric and SQL Trivia Challenge
                </h1>
                <p className="mt-2 text-base text-white/70 md:text-lg">
                  Begin your quest of knowledge
                </p>
              </div>

              {displayedError && (
                <div className="relative mt-8 rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {displayedError}
                </div>
              )}

              <form onSubmit={handleSubmit} autoComplete="off" className="relative mt-8 space-y-6">
                <div className="space-y-2">
                  <label htmlFor="playerName" className="block text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
                    Name *
                  </label>
                  <p className="text-xs font-normal text-white/45">
                    Can be a nickname and will be how you find yourself on the leaderboard
                  </p>
                  <input
                    type="text"
                    id="playerName"
                    name="playerName"
                    required
                    value={formData.playerName}
                    onChange={handleChange}
                    disabled={isLockdownActive}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-base text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-400/40 placeholder:text-white/40"
                    placeholder="Enter your name"
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="playerEmail" className="block text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
                    Email *
                  </label>
                  <input
                    type="email"
                    id="playerEmail"
                    name="playerEmail"
                    required
                    value={formData.playerEmail}
                    onChange={handleChange}
                    disabled={isLockdownActive}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-base text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-400/40 placeholder:text-white/40"
                    placeholder="Enter your email"
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="playerPhone" className="block text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
                    Phone *
                  </label>
                  <input
                    type="tel"
                    id="playerPhone"
                    name="playerPhone"
                    value={formData.playerPhone}
                    onChange={handleChange}
                    disabled={isLockdownActive}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-base text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-400/40 placeholder:text-white/40"
                    placeholder="Enter your phone number"
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="country" className="block text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
                    Country/region *
                  </label>
                  <select
                    id="country"
                    name="country"
                    required
                    value={formData.country}
                    onChange={handleChange}
                    disabled={isLockdownActive}
                    className="w-full appearance-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-base text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                  >
                    <option value="" className="bg-neutral-950 text-white/60">
                      Select your country/region
                    </option>
                    {countries.map(countryOption => (
                      <option key={countryOption} value={countryOption} className="bg-neutral-950 text-white">
                        {countryOption}
                      </option>
                    ))}
                  </select>
                </div>

                {formData.country === 'United States' && (
                  <div className="space-y-2">
                    <label htmlFor="state" className="block text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
                      State *
                    </label>
                    <select
                      id="state"
                      name="state"
                      required
                      value={formData.state}
                      onChange={handleChange}
                      disabled={isLockdownActive}
                      className="w-full appearance-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-base text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                    >
                      <option value="" className="bg-neutral-950 text-white/60">
                        Select your state
                      </option>
                      {states.map(stateOption => (
                        <option key={stateOption} value={stateOption} className="bg-neutral-950 text-white">
                          {stateOption}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || isLockdownActive}
                  className="w-full rounded-2xl py-3.5 text-lg font-semibold text-[#2b1800] shadow-[0_18px_40px_rgba(245,158,11,0.45)] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-70 hover:brightness-[1.08] hover:shadow-[0_22px_48px_rgba(245,158,11,0.55)] active:brightness-[0.96]"
                  style={{ background: 'linear-gradient(180deg, #fbbf24 0%, #f59e0b 55%, #b45309 100%)' }}
                >
                  {isSubmitting ? 'Registering...' : 'Begin Challenge'}
                </button>
              </form>

              <div className="relative mt-6 space-y-4 text-center text-xs leading-relaxed text-white/45">
                <p>
                  Your privacy matters to us. The contact details you share for the Microsoft Fabric and SQL Trivia Challenge will only be used during FabCon/SQLCon to keep you updated on the game—think leaderboard highlights, daily prizes, and tips to boost your score.
                </p>
                <p>
                  When you start the Challenge, your gameplay and telemetry data feed the Microsoft Fabric Real-Time Intelligence demo so attendees can see live analytics. That telemetry may inform post-event learnings or future Microsoft marketing.
                </p>
                <div>
                  Review the{' '}
                  <a
                    href="http://aka.ms/igniteRTI-racingrules"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative inline-flex items-center justify-center text-amber-300 transition hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
                  >
                    Terms and Conditions
                    <span className="pointer-events-none absolute left-1/2 bottom-full z-20 hidden -translate-x-1/2 -translate-y-3 rounded-2xl border border-white/10 bg-neutral-950/95 p-4 text-white shadow-[0_18px_30px_rgba(0,0,0,0.45)] group-hover:flex group-focus-visible:flex">
                      <span className="flex flex-col items-center gap-2">
                        <span className="text-[0.68rem] uppercase tracking-[0.2em] text-white/60">Scan QR</span>
                        <div className="rounded-xl bg-white p-1"><QRCode value="http://aka.ms/igniteRTI-racingrules" size={96} /></div>
                      </span>
                    </span>
                  </a>{' '}
                  before you begin your challenge run.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
