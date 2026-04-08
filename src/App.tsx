import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import * as XLSX from 'xlsx'

type InventoryItem = {
  code: string
  name: string
  count: number
}

type Mode = 'scanner' | 'camera'

const STORAGE_KEY = 'remanent-items-v1'
const AUTH_KEY = 'remanent-auth-v1'
const AUTH_USER = 'magazyn'
const AUTH_PASS = '!DemartRemanent123'
const SCAN_COOLDOWN_MS = 1200

const formatDate = (date: Date) =>
  date.toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

const normalizeCode = (value: string) => value.trim()

const loadItems = (): InventoryItem[] => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as InventoryItem[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => typeof item?.code === 'string')
      .map((item) => ({
        code: item.code,
        name: typeof item?.name === 'string' ? item.name : '',
        count: Number.isFinite(item?.count) ? Number(item.count) : 0,
      }))
  } catch {
    return []
  }
}

const saveItems = (items: InventoryItem[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

const updateItem = (
  items: InventoryItem[],
  code: string,
  updater: (item: InventoryItem) => InventoryItem,
) =>
  items.map((item) => (item.code === code ? updater(item) : item))

const upsertItem = (items: InventoryItem[], code: string) => {
  const existing = items.find((item) => item.code === code)
  if (existing) {
    return updateItem(items, code, (item) => ({ ...item, count: item.count + 1 }))
  }
  return [{ code, name: '', count: 1 }, ...items]
}

const totalCount = (items: InventoryItem[]) =>
  items.reduce((acc, item) => acc + item.count, 0)

const CameraScanner = ({
  onDetect,
  onUserGesture,
}: {
  onDetect: (code: string) => void
  onUserGesture?: () => void | Promise<void>
}) => {
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readerId = useMemo(
    () => `reader-${Math.random().toString(36).slice(2, 10)}`,
    [],
  )
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScanRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    scannerRef.current = new Html5Qrcode(readerId)
    return () => {
      if (!scannerRef.current) return
      const scanner = scannerRef.current
      scannerRef.current = null
      if (scanner.isScanning) {
        scanner
          .stop()
          .catch(() => undefined)
          .finally(() => scanner.clear())
      } else {
        scanner.clear()
      }
    }
  }, [readerId])

  const handleDetected = (decodedText: string) => {
    const normalized = normalizeCode(decodedText)
    if (!normalized) return
    const now = Date.now()
    const last = lastScanRef.current.get(normalized) ?? 0
    if (now - last < SCAN_COOLDOWN_MS) return
    lastScanRef.current.set(normalized, now)
    onDetect(normalized)
  }

  const startScanner = async () => {
    if (!scannerRef.current || running || starting) return
    setError(null)
    setStarting(true)
    if (onUserGesture) {
      try {
        await onUserGesture()
      } catch {
        // Ignore audio unlock failures.
      }
    }
    const config = {
      fps: 12,
      aspectRatio: 16 / 9,
      qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
        const width = Math.min(360, Math.floor(viewfinderWidth * 0.88))
        const height = Math.min(120, Math.floor(viewfinderHeight * 0.55))
        return { width, height }
      },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR,
      ],
    }

    try {
      await scannerRef.current.start(
        { facingMode: 'environment' },
        config,
        handleDetected,
        () => undefined,
      )
      setRunning(true)
    } catch (err) {
      try {
        const cameras = await Html5Qrcode.getCameras()
        if (!cameras.length) {
          throw new Error('Brak dostępnej kamery.')
        }
        await scannerRef.current.start(
          { deviceId: { exact: cameras[0].id } },
          config,
          handleDetected,
          () => undefined,
        )
        setRunning(true)
      } catch (innerError) {
        setError(
          innerError instanceof Error
            ? innerError.message
            : 'Nie udało się uruchomić kamery.',
        )
      }
    } finally {
      setStarting(false)
    }
  }

  const stopScanner = async () => {
    if (!scannerRef.current || !running) return
    await scannerRef.current.stop()
    scannerRef.current.clear()
    setRunning(false)
  }

  return (
    <div className="panel scanner-panel">
      <div className="panel-header">
        <div>
          <h2>Aparat</h2>
          {/* <p>Skanuj kod aparatem telefonu. Każdy odczyt zwiększa licznik.</p> */}
        </div>
        <button
          className="button primary"
          onClick={running ? stopScanner : startScanner}
          type="button"
          disabled={starting}
        >
          {running ? 'Zatrzymaj aparat' : starting ? 'Uruchamianie…' : 'Uruchom aparat'}
        </button>
      </div>
      <div className="camera-shell">
        <div id={readerId} className={`camera-feed ${running ? 'live' : ''}`} />
        <div className="scan-frame" aria-hidden="true" />
        {!running && (
          <div className="camera-hint">
            <span>Dotknij „Uruchom aparat”, aby rozpocząć skanowanie.</span>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

const App = () => {
  const [isAuthed, setIsAuthed] = useState(
    () => localStorage.getItem(AUTH_KEY) === '1',
  )
  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('scanner')
  const [items, setItems] = useState<InventoryItem[]>(() => loadItems())
  const [scanInput, setScanInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const unlockAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume()
      } catch {
        // Ignore resume failures (autoplay policy).
      }
    }
  }

  const playBeep = () => {
    const context = audioContextRef.current
    if (!context) return
    if (context.state !== 'running') {
      context
        .resume()
        .then(() => {
          if (context.state === 'running') {
            playBeep()
          }
        })
        .catch(() => undefined)
      return
    }
    const oscillator = context.createOscillator()
    const gainNode = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gainNode.gain.setValueAtTime(0.0001, context.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14)
    oscillator.connect(gainNode)
    gainNode.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.16)
  }

  useEffect(() => {
    saveItems(items)
  }, [items])

  useEffect(() => {
    if (isAuthed) {
      localStorage.setItem(AUTH_KEY, '1')
    } else {
      localStorage.removeItem(AUTH_KEY)
    }
  }, [isAuthed])

  useEffect(() => {
    if (mode === 'scanner') {
      inputRef.current?.focus()
    }
  }, [mode])

  const handleScan = (value: string) => {
    const normalized = normalizeCode(value)
    if (!normalized) return
    setItems((prev) => upsertItem(prev, normalized))
    playBeep()
  }

  const handleLogin = (event: FormEvent) => {
    event.preventDefault()
    if (authUser === AUTH_USER && authPass === AUTH_PASS) {
      setIsAuthed(true)
      setAuthError(null)
      setAuthUser('')
      setAuthPass('')
      return
    }
    setAuthError('Nieprawidłowy login lub hasło.')
  }

  const handleLogout = () => {
    setIsAuthed(false)
    setMode('scanner')
  }

  if (!isAuthed) {
    return (
      <div className="page auth-page">
        <div className="panel auth-card">
          <div className="panel-header">
            <div>
              <h2>Logowanie</h2>
              <p>Wprowadź dane dostępu magazynu.</p>
            </div>
          </div>
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="field">
              <span>Użytkownik</span>
              <input
                value={authUser}
                onChange={(event) => {
                  setAuthUser(event.target.value)
                  if (authError) setAuthError(null)
                }}
                autoComplete="username"
                placeholder="magazyn"
                autoFocus
              />
            </label>
            <label className="field">
              <span>Hasło</span>
              <input
                type="password"
                value={authPass}
                onChange={(event) => {
                  setAuthPass(event.target.value)
                  if (authError) setAuthError(null)
                }}
                autoComplete="current-password"
                placeholder="••••••••••"
              />
            </label>
            {authError && <p className="error">{authError}</p>}
            <button className="button primary" type="submit">
              Zaloguj
            </button>
          </form>
        </div>
      </div>
    )
  }

  const handleManualAdd = () => {
    void unlockAudio()
    handleScan(scanInput)
    setScanInput('')
    inputRef.current?.focus()
  }

  const handleExport = () => {
    const rows = items.map((item) => ({
      Kod: item.code,
      Nazwa: item.name,
      Ilość: item.count,
    }))
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Remanent')
    const filename = `remanent-${formatDate(new Date()).replaceAll('.', '-')}.xlsx`
    XLSX.writeFile(workbook, filename)
  }

  const handleClear = () => {
    if (!window.confirm('Wyczyścić wszystkie pozycje?')) return
    setItems([])
  }

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-top">
          <div>
            {/* <p className="eyebrow">Remanent</p> */}
            <h1>Remanent w Demarcie</h1>
            {/* <p className="lead">
              Szybko zliczaj produkty z czytnika lub aparatu. Edytuj ilości i
              eksportuj do XLSX.
            </p> */}
          </div>
          <div className="auth-actions">
            <button className="button ghost" type="button" onClick={handleLogout}>
              Wyloguj
            </button>
          </div>
          {/* <div className="stats">
            <div>
              <span>Pozycje</span>
              <strong>{items.length}</strong>
            </div>
            <div>
              <span>Łącznie</span>
              <strong>{totalCount(items)}</strong>
            </div>
            <div>
              <span>Data</span>
              <strong>{formatDate(new Date())}</strong>
            </div>
          </div> */}
        </div>
        <div className="mode-toggle">
          <button
            className={`toggle ${mode === 'scanner' ? 'active' : ''}`}
            onClick={() => setMode('scanner')}
            type="button"
          >
            Skaner
          </button>
          <button
            className={`toggle ${mode === 'camera' ? 'active' : ''}`}
            onClick={() => setMode('camera')}
            type="button"
          >
            Aparat
          </button>
        </div>
      </header>

      <main className="grid">
        {mode === 'scanner' ? (
          <section className="panel scanner-panel">
            <div className="panel-header">
              <div>
                <h2>Skaner </h2>
                {/* <p>Użyj czytnika USB/Bluetooth lub wpisz kod ręcznie.</p> */}
              </div>
              {/* <div className="badge">Wejście klawiatury</div> */}
            </div>
            <div className="scanner-input">
              <input
                ref={inputRef}
                value={scanInput}
                onFocus={() => void unlockAudio()}
                onChange={(event) => setScanInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleManualAdd()
                  }
                }}
                placeholder="Zeskanuj lub wpisz kod..."
                aria-label="Kod kreskowy"
              />
              <button className="button primary" onClick={handleManualAdd} type="button">
                Dodaj skan
              </button>
            </div>
            {/* <div className="hint">
              Każdy strzał z czytnika zwiększa ilość produktu o 1.
            </div> */}
          </section>
        ) : (
          <CameraScanner onDetect={handleScan} onUserGesture={unlockAudio} />
        )}

        <section className="panel table-panel">
          <div className="panel-header">
            <div>
              {/* <h2>Tabela remanentu</h2>
              <p>Możesz edytować nazwy i ilości bezpośrednio.</p> */}
            </div>
            <div className="panel-actions">
              {/* <button className="button ghost" onClick={handleClear} type="button">
                Wyczyść
              </button> */}
              <button className="button primary" onClick={handleExport} type="button">
                Eksport
              </button>
            </div>
          </div>

          <div className="table">
            <div className="table-header">
              <span>Kod</span>
              <span>Nazwa / opis</span>
              <span>Ilość</span>
              <span>Akcje</span>
            </div>
            {items.length === 0 ? (
              <div className="empty">Brak pozycji. Zeskanuj pierwszy kod.</div>
            ) : (
              items.map((item) => (
                <div key={item.code} className="table-row">
                  <span className="code">{item.code}</span>
                  <input
                    value={item.name}
                    onChange={(event) =>
                      setItems((prev) =>
                        updateItem(prev, item.code, (current) => ({
                          ...current,
                          name: event.target.value,
                        })),
                      )
                    }
                    placeholder="Dodaj nazwę produktu"
                    aria-label={`Nazwa produktu ${item.code}`}
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.count}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      setItems((prev) =>
                        updateItem(prev, item.code, (current) => ({
                          ...current,
                          count: Number.isFinite(value)
                            ? Math.max(0, value)
                            : current.count,
                        })),
                      )
                    }}
                    aria-label={`Ilość dla kodu ${item.code}`}
                  />
                  <div className="row-actions">
                    <button
                      className="chip"
                      onClick={() =>
                        setItems((prev) =>
                          updateItem(prev, item.code, (current) => ({
                            ...current,
                            count: Math.max(0, current.count - 1),
                          })),
                        )
                      }
                      type="button"
                    >
                      −
                    </button>
                    <button
                      className="chip"
                      onClick={() =>
                        setItems((prev) =>
                          updateItem(prev, item.code, (current) => ({
                            ...current,
                            count: current.count + 1,
                          })),
                        )
                      }
                      type="button"
                    >
                      +
                    </button>
                    <button
                      className="chip danger"
                      onClick={() =>
                        setItems((prev) => prev.filter((row) => row.code !== item.code))
                      }
                      type="button"
                    >
                      Usuń
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
