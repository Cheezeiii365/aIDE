import '@testing-library/jest-dom/vitest'

// Dockview requires ResizeObserver which jsdom does not provide
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
