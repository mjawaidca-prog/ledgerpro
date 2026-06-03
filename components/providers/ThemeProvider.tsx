'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
type Density = 'comfortable' | 'compact'

interface ThemeContextValue {
  theme: Theme
  density: Density
  setTheme: (t: Theme) => void
  setDensity: (d: Density) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  density: 'comfortable',
  setTheme: () => {},
  setDensity: () => {},
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [density, setDensityState] = useState<Density>('comfortable')

  useEffect(() => {
    const savedTheme = (localStorage.getItem('lp-theme') as Theme) || 'light'
    const savedDensity = (localStorage.getItem('lp-density') as Density) || 'comfortable'
    setThemeState(savedTheme)
    setDensityState(savedDensity)
    document.documentElement.setAttribute('data-theme', savedTheme)
    document.documentElement.setAttribute('data-density', savedDensity)
  }, [])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem('lp-theme', t)
    document.documentElement.setAttribute('data-theme', t)
  }

  const setDensity = (d: Density) => {
    setDensityState(d)
    localStorage.setItem('lp-density', d)
    document.documentElement.setAttribute('data-density', d)
  }

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, density, setTheme, setDensity, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function useDensity() {
  const { density, setDensity } = useContext(ThemeContext)
  return { density, setDensity }
}
