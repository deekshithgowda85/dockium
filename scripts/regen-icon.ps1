Add-Type -AssemblyName System.Drawing

$iconPath = "d:\Projects\dockium\electron\assets\dockium.ico"
$size = 256
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(12, 24, 44))

function New-RoundedPath {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height,
    [int]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($X, $Y, $Radius, $Radius, 180, 90)
  $path.AddArc($X + $Width - $Radius, $Y, $Radius, $Radius, 270, 90)
  $path.AddArc($X + $Width - $Radius, $Y + $Height - $Radius, $Radius, $Radius, 0, 90)
  $path.AddArc($X, $Y + $Height - $Radius, $Radius, $Radius, 90, 90)
  $path.CloseFigure()
  return $path
}

$outerPath = New-RoundedPath -X 16 -Y 16 -Width 224 -Height 224 -Radius 48
$outerRect = New-Object System.Drawing.Rectangle 16, 16, 224, 224
$outerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $outerRect,
  [System.Drawing.Color]::FromArgb(54, 106, 222),
  [System.Drawing.Color]::FromArgb(24, 168, 136),
  35
)
$graphics.FillPath($outerBrush, $outerPath)

$corePath = New-RoundedPath -X 56 -Y 56 -Width 144 -Height 144 -Radius 34
$coreBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 29, 55))
$graphics.FillPath($coreBrush, $corePath)

$ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(232, 250, 255, 255), 12)
$ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($ringPen, 94, 86, 92, 92, 220, 280)

$cutBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 29, 55))
$graphics.FillRectangle($cutBrush, 139, 86, 66, 92)

$linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(218, 245, 250, 255), 9)
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($linePen, 88, 178, 176, 178)

$iconHandle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$stream = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create)
$icon.Save($stream)
$stream.Close()

$graphics.Dispose()
$bitmap.Dispose()

Write-Output $iconPath
