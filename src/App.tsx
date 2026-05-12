import { useCallback, useState } from 'react'
import { AncientLibraryShell } from '@/components/layout/AncientLibraryShell'
import { Cover } from '@/components/layout/Cover'
import { MobileBlock } from '@/components/layout/MobileBlock'
import { IntakeScreen, type IntakeParams } from '@/components/upload/IntakeScreen'

type Stage = 'cover' | 'cover-opening' | 'intake'

function App() {
  const [stage, setStage] = useState<Stage>('cover')

  const handleBeginCover = useCallback(() => {
    setStage((current) => (current === 'cover' ? 'cover-opening' : current))
  }, [])

  const handleCoverOpened = useCallback(() => {
    setStage('intake')
  }, [])

  const handleIntakeBegin = useCallback((params: IntakeParams) => {
    void params
    // TODO Wave 6: hand the params to the orchestrator/pipeline.
  }, [])

  return (
    <>
      <MobileBlock />
      <AncientLibraryShell>
        {stage === 'intake' ? (
          <IntakeScreen onBegin={handleIntakeBegin} />
        ) : (
          <Cover
            isOpening={stage === 'cover-opening'}
            onBegin={handleBeginCover}
            onAnimationComplete={handleCoverOpened}
          />
        )}
      </AncientLibraryShell>
    </>
  )
}

export default App
