import { fireEvent, screen } from '@testing-library/react'

/** Opens the select named `label` and picks `option`, with the pointer sequence Base UI listens for. */
export async function chooseOption(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item, { pointerType: 'mouse' })
  fireEvent.mouseDown(item)
  fireEvent.pointerUp(item, { pointerType: 'mouse' })
  fireEvent.mouseUp(item)
  fireEvent.click(item)
}
