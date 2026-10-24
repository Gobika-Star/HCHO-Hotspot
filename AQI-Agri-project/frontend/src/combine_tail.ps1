# Combine the clean head with the three tail parts into App.jsx

$base = "C:\Users\hp\OneDrive\Desktop\Agricultural_Risk_Dashboard\frontend\src"

$head = Get-Content -Path "$base\App.jsx" | Select-Object -First 592
$part1 = Get-Content -Path "$base\App_tail_part1.jsx"
$part2 = Get-Content -Path "$base\App_tail_part2.jsx"
$part3 = Get-Content -Path "$base\App_tail_part3.jsx"

$all = @() + $head + $part1 + $part2 + $part3

Set-Content -Path "$base\App.jsx" -Value $all -NoNewline -Encoding UTF8
Write-Host "Combined. Total lines: $($all.Count)"