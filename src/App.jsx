import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { Keypair } from '@solana/web3.js'

function App() {
  const [count, setCount] = useState(0)
  const [publicKey, setPublicKey] = useState(null)

  useEffect(() => {
    const newKeypair = Keypair.generate()
    setPublicKey(newKeypair.publicKey.toBase58())
  }, [])

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank" rel="noopener noreferrer">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noopener noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      {publicKey && (
        <div>
          <h2>New Solana Keypair Generated:</h2>
          <p>Public Key: {publicKey}</p>
        </div>
      )}
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.jsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
