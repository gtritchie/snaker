' ============================================================
'  SNAKER
'  By Gary Ritchie - March 1983
'  Box 393, Bellevue, Alberta, Canada T0K-0C0
' ============================================================
'
'  TRS-80 Color Computer - Extended Color BASIC
'
'  NOTE: Original 2-char variable name limit means these
'  longer names are for readability only. Original short
'  names shown in comments on first use.
'
'  Video RAM layout: 1024-1535 (32 cols x 16 rows)
'  Row 0 starts at 1024, Row 15 starts at 1504
' ============================================================

' ------------------------------------------------------------
'  Initialize system and variables
' ------------------------------------------------------------

POKE 65494, 0                           ' Enable double-speed mode

leftEdge  = 1025                        ' L  - left boundary of current row
rightEdge = 1054                        ' R  - right boundary of current row
playerPos = 1039                        ' P  - player screen position (centered)
moveDir   = 0                           ' M  - horizontal movement direction
elapsed   = 0                           ' HT - elapsed timer ticks
runs      = 0                           ' Q  - number of completed runs (win at 3)
bestTicks = 70000                       ' BS - best score in ticks (lower is better)
score     = 0                           ' SC - score converted to seconds

FOR i = 1 TO 5                          ' PP - loop counter
    READ colorVal                       ' PL - read color block character
    colors(i) = colorVal                ' C() - semigraphic color block values
NEXT i

DATA 159, 191, 207, 239, 255           ' Green, yellow, blue, red, orange blocks

' ------------------------------------------------------------
'  Title screen
' ------------------------------------------------------------

CLS RND(4) + 1

PRINT@ 192, STRING$(32, "%");
PRINT@ 224, STRING$(13, 255);
PRINT@ 237, "snaker";
PRINT@     , STRING$(13, 255);
PRINT@     , STRING$(32, "%");

' Play "Bublitchki" (Russian folk melody)
PLAY "T4 O3 V25 L8 D G A L4 B L8 A G P8 O4 D C# C O3 L4 B L8 A G P8 D G B O4 L4 D L8 C# L4 D O3 L8 B A G L4... B L8 B O4 E D# L4 E O3 L8 B L4 O4 C L8 O3 B O4 D C L4 O3 B L8 A L4 G L8 B O4 D C O3 B P8 A L4 B L8 A G F# E P8 B P4 O4 E"

' Wait for keypress
waitForKey:
    PRINT@ 480, "<<press ANY key TO START>>";
    IF INKEY$ = "" THEN GOTO waitForKey

' ------------------------------------------------------------
'  Setup - draw left and right border walls
' ------------------------------------------------------------

GOSUB enableHighSpeed

CLS

FOR i = 1024 TO 1504 STEP 32
    POKE i, 175                         ' Left wall (orange block)
    PLAY "T255 O4 A B"
    POKE i + 31, 175                    ' Right wall
    PLAY "O4 E"
NEXT i

TIMER = 0

' ------------------------------------------------------------
'  Main game loop - snake descends the screen
' ------------------------------------------------------------

mainLoop:
    FOR snakePass = 1 TO 2              ' QQ - two passes per row
        FOR snakeChar = 148 TO 244 STEP 16  ' N - snake body graphic characters

            ' Read joystick for horizontal movement
            moveDir = (JOYSTK(0) < 6) - (JOYSTK(0) > 57)

            ' Read joystick for speed delay
            speed = JOYSTK(3)           ' SP

            ' Move player horizontally, clamping to boundaries
            playerPos = playerPos + moveDir
            IF playerPos < leftEdge THEN playerPos = leftEdge
            IF playerPos > rightEdge THEN playerPos = rightEdge

            ' Check for collision with obstacle
            IF PEEK(playerPos) <> 96 THEN GOTO crashHandler

            ' Place snake segment at current position
            POKE playerPos, snakeChar
            PLAY "O2 T255 G O3 C"

            ' Speed delay from joystick
            FOR i = 1 TO speed
            NEXT i

            ' Scatter random color blocks on bottom row
            POKE RND(30) + 1504, colors(RND(5))
            POKE RND(30) + 1504, colors(RND(5))

            ' Seal bottom row edges
            POKE 1504, 175
            PRINT@ 511, CHR$(175);

        NEXT snakeChar
    NEXT snakePass

' ------------------------------------------------------------
'  Advance snake to next row
' ------------------------------------------------------------

leftEdge  = leftEdge  + 32
rightEdge = rightEdge + 32

' Check if snake reached the bottom
IF leftEdge = 1441 THEN
    POKE playerPos, 148
    playerPos = playerPos + 32
    POKE playerPos, 244
    GOTO reachedBottom
END IF

' Move player down one row and continue
POKE playerPos, 148
playerPos = playerPos + 32
GOTO mainLoop

' ------------------------------------------------------------
'  Crash handler - back up one row
' ------------------------------------------------------------

crashHandler:
    leftEdge  = leftEdge  - 32
    rightEdge = rightEdge - 32
    IF leftEdge < 1025 THEN
        leftEdge = 1025
        rightEdge = rightEdge + 32
    END IF

    ' Flash screen and play crash sound
    FOR j = 1 TO 2
        PLAY "O2 T2 L8 B"
        SCREEN 0, 1
        PLAY "L8 E"
        SCREEN 0, 0
    NEXT j

    ' Scatter obstacle, clear area around player, back up one row
    POKE RND(29) + 1505, colors(RND(5))
    POKE 1504, 175
    POKE 1535, 175
    POKE playerPos, 96
    playerPos = playerPos - 32
    POKE playerPos, 96
    POKE playerPos + 1, 96
    POKE playerPos - 1, 96
    IF playerPos < 1025 THEN playerPos = playerPos + 32

    GOTO mainLoop

' ------------------------------------------------------------
'  Reached bottom of screen - check for win
' ------------------------------------------------------------

reachedBottom:
    elapsed = TIMER
    runs = runs + 1
    IF runs = 3 THEN GOTO winSequence

    ' Celebration for completing a run
    FOR i = 1 TO 15
        PLAY "O4 T255 A B E"
        POKE 1504, 175
        PRINT@ 511, CHR$(175);
    NEXT i
    POKE 1504, 175
    POKE 1535, 175

    ' Reset position for next run
    leftEdge  = 1025
    rightEdge = 1054
    playerPos = 1039
    moveDir   = 0
    TIMER     = elapsed
    GOTO mainLoop

' ------------------------------------------------------------
'  Win sequence - triumphant fanfare
' ------------------------------------------------------------

winSequence:
    POKE 65494, 0                       ' Back to normal speed for music

    CLS RND(8)
    PLAY "V7  O2 T2 L8 F A O3 B C L4 F L8 C L4. F"
    GOSUB playArpeggio

    CLS RND(8)
    PLAY "V>  O2 T2 L8 A O3 C E L4. G L8 E L4. G"
    GOSUB playArpeggio

    CLS RND(8)
    PLAY "V>  O3 T2 L8 C F A O4 L4 C O5 L8 A O4 L4. C"
    GOSUB playArpeggio

    PLAY "V15"
    GOTO showScore

' Arpeggio fill between fanfare phrases
playArpeggio:
    PLAY "T255 O1 E F G B C A E D A G F C E D C B G E A D D A B C G E A D G C A E F E B C E D G A E D B C D E D G B C E D C"
    RETURN

' ------------------------------------------------------------
'  Score display - convert ticks to MM:SS
' ------------------------------------------------------------

showScore:
    CLS RND(4) + 1
    PRINT@ 168, "YOU MADE IT IN:";

    score = elapsed / 60                ' Convert ticks to seconds (60 ticks/sec)

    ' Format minutes
    minutes$ = LEFT$(STR$(INT(score / 60)), 3)
    IF VAL(minutes$) < 1 THEN minutes$ = "00"
    IF LEN(minutes$) > 2 THEN minutes$ = RIGHT$(minutes$, 2)

    ' Format seconds
    seconds$ = LEFT$(STR$(INT(score - INT(score / 60) * 60)), 3)
    IF LEN(seconds$) < 3 THEN
        seconds$ = "0" + RIGHT$(seconds$, 1)
    ELSE
        seconds$ = RIGHT$(seconds$, 2)
    END IF

    ' Draw decorative bar
    FOR i = 1312 TO 1343
        POKE i, 33
    NEXT i

    ' Display formatted time
    timeStr$ = minutes$ + ":" + seconds$    ' P$
    PRINT@ 301, timeStr$;

    ' Play ascending chromatic scale
    FOR octave = 1 TO 5
        FOR note = 1 TO 12
            PLAY "T255 O" + STR$(octave) + "N" + STR$(note)
        NEXT note
    NEXT octave

    ' Pause to admire
    FOR i = 1 TO 1800
    NEXT i

    ' Check for new best score
    IF elapsed < bestTicks THEN GOSUB newBestScore

' ------------------------------------------------------------
'  Show best score
' ------------------------------------------------------------

    CLS 0
    PRINT@ 10, "BEST SCORE";

    PRINT@ 224, STRING$(32, 143);
    PRINT@ 192, STRING$(32, 255);
    PRINT@ 256, STRING$(32, 255);

    PRINT@ 224, playerName$; "----------"; bestTimeStr$

    ' Play descending chromatic scale
    FOR octave = 5 TO 1 STEP -1
        FOR note = 12 TO 1 STEP -1
            PLAY "T255 O" + STR$(octave) + "N" + STR$(note)
        NEXT note
    NEXT octave

    ' Pause
    FOR i = 1 TO 1800
    NEXT i

' ------------------------------------------------------------
'  Play again?
' ------------------------------------------------------------

playAgainPrompt:
    SOUND 100, 2
    CLS
    PRINT "ANOTHER GAME (Y/N)"

waitForInput:
    input$ = INKEY$
    IF input$ = "" THEN GOTO waitForInput

    IF input$ = "N" THEN
        PRINT "BEST SCORE: "; playerName$
        PRINT
        PRINT bestTimeStr$
        PRINT
        GOTO programEnd
    END IF

    IF input$ <> "Y" THEN
        SOUND 25, 1
        GOTO playAgainPrompt
    END IF

' ------------------------------------------------------------
'  Reset and start new game
' ------------------------------------------------------------

    GOSUB enableHighSpeed
    leftEdge  = 1025
    rightEdge = 1054
    playerPos = 1039
    moveDir   = 0
    runs      = 0
    score     = 0
    GOTO setupScreen                    ' Jump to line 100 equivalent

' ------------------------------------------------------------
'  Subroutine: New best score
' ------------------------------------------------------------

newBestScore:
    bestTicks    = elapsed
    elapsed      = 0
    bestTimeStr$ = timeStr$

    CLS RND(8)
    PRINT "WHAT IS YOUR NAME";
    LINE INPUT ">>>>?"; playerName$
    RETURN

' ------------------------------------------------------------
'  Subroutine: Enable high-speed mode
'  If your CoCo cannot handle the high-speed POKE,
'  change this to just RETURN
' ------------------------------------------------------------

enableHighSpeed:
    POKE 65495, 0                       ' Enable double-speed (1.78 MHz)
    RETURN

programEnd:
    END

