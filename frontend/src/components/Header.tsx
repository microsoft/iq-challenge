/**
 * Header Component
 * 
 * Displays the game title and welcome message
 */

interface HeaderProps {
  userName?: string
}

export default function Header({ userName }: HeaderProps) {
  return (
    <header className="w-full py-6 px-4 text-center">
      <h1 className="text-3xl md:text-4xl font-bold text-foreground">
        The Microsoft Fabric & SQL Trivia Challenge
      </h1>
      {userName && (
        <p className="text-lg md:text-xl text-muted-foreground mt-2">
          Welcome, {userName}!
        </p>
      )}
    </header>
  )
}
