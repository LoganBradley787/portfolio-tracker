// Makes the display setting (real or hidden figures) a React concern:
// changing it remounts everything beneath, so every formatted figure follows.
import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import { display, type Display } from './display.ts';

const DisplayContext = createContext<{ display: Display; setDisplay: (d: Display) => void }>({ display: { mode: 'real' }, setDisplay: () => {} });

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [d, setD] = useState<Display>(display.get());
  const setDisplay = (next: Display) => {
    display.set(next);
    setD(next);
  };
  return (
    <DisplayContext.Provider value={{ display: d, setDisplay }}>
      <Fragment key={JSON.stringify(d)}>{children}</Fragment>
    </DisplayContext.Provider>
  );
}

export const useDisplay = () => useContext(DisplayContext);
