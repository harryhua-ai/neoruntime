import { useTranslation } from 'react-i18next'
import PeripheralControl from './components/PeripheralControl'

export default function Peripherals() {
  const { t } = useTranslation()

  return (
    <div className="h-full w-full overflow-y-auto bg-background p-4 md:p-6">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {t('common.peripherals')}
        </h1>
        <PeripheralControl />
      </div>
    </div>
  )
}
