import type { Voice } from './types'

type Row = [string, Voice['gender'], Voice['age'], string, string, string]
const rows: Row[] = [
  ['Aanya', 'Female', 'Young', 'English (India)', 'Indian', 'Warm'], ['Kabir', 'Male', 'Adult', 'English (India)', 'Indian', 'Calm'],
  ['Priya', 'Female', 'Adult', 'English (India)', 'Indian', 'Friendly'], ['Vikram', 'Male', 'Mature', 'Hindi', 'Indian', 'Confident'],
  ['Maya', 'Female', 'Young', 'Hindi', 'Indian', 'Energetic'], ['Rohan', 'Male', 'Young', 'English (India)', 'Indian', 'Playful'],
  ['Emma', 'Female', 'Adult', 'English (US)', 'American', 'Friendly'], ['Jack', 'Male', 'Adult', 'English (US)', 'American', 'Professional'],
  ['Olivia', 'Female', 'Young', 'English (UK)', 'British', 'Warm'], ['Oliver', 'Male', 'Mature', 'English (UK)', 'British', 'Calm'],
  ['Sophie', 'Female', 'Adult', 'English (AU)', 'Australian', 'Cheerful'], ['Liam', 'Male', 'Young', 'English (AU)', 'Australian', 'Playful'],
  ['Lucía', 'Female', 'Adult', 'Spanish', 'Neutral', 'Warm'], ['Mateo', 'Male', 'Adult', 'Spanish', 'Neutral', 'Confident'],
  ['Léa', 'Female', 'Young', 'French', 'Neutral', 'Friendly'], ['Hugo', 'Male', 'Mature', 'French', 'Neutral', 'Calm'],
  ['Selvi', 'Female', 'Adult', 'Tamil', 'Indian', 'Warm'], ['Arun', 'Male', 'Adult', 'Tamil', 'Indian', 'Professional'],
  ['Deepa', 'Female', 'Mature', 'Hindi', 'Indian', 'Calm'], ['Sanjay', 'Male', 'Adult', 'Hindi', 'Indian', 'Energetic'],
  ['Grace', 'Female', 'Mature', 'English (US)', 'American', 'Professional'], ['Noah', 'Male', 'Young', 'English (US)', 'American', 'Cheerful'],
  ['Ananya', 'Female', 'Young', 'Bengali', 'Indian', 'Friendly'], ['Ishaan', 'Male', 'Adult', 'Marathi', 'Indian', 'Calm'],
]
const providers = ['Engine A', 'Engine B', 'Engine C']
export const voices: Voice[] = rows.map(([name, gender, age, lang, accent, style], i) => ({
  id: 'v' + (i + 1), name, gender, age, lang, accent, style, provider: providers[i % 3],
}))
