import { createContext, useContext } from 'react';

export const Ui = createContext(null);

export function useUi() {
    return useContext(Ui);
}
