# Combine all parts into App.jsx
# Order: head -> mid -> mid2 -> dashboard -> tail1 -> tail2 -> tail3

$base = "C:\Users\hp\OneDrive\Desktop\Agricultural_Risk_Dashboard\frontend\src"

function ReadPart($name) {
    $lines = Get-Content -Path "$base\$name" -Encoding UTF8
    return $lines
}

$head   = ReadPart "App_head.jsx"
$mid    = ReadPart "App_mid.jsx"
$mid2   = ReadPart "App_mid2.jsx"
$dash   = ReadPart "App_dashboard.jsx"
$tail1  = ReadPart "App_tail_part1.jsx"
$tail2  = ReadPart "App_tail_part2.jsx"
$tail3  = ReadPart "App_tail_part3.jsx"
$end    = ReadPart "App_end.jsx"

Write-Host "Parts: head=$($head.Count) mid=$($mid.Count) mid2=$($mid2.Count) dash=$($dash.Count) t1=$($tail1.Count) t2=$($tail2.Count) t3=$($tail3.Count) end=$($end.Count)"

$all = @() + $head + $mid + $mid2 + $dash + $tail1 + $tail2 + $tail3 + $end
Write-Host "Total lines: $($all.Count)"

# Ensure file ends with newline
$content = $all -join "`n" + "`n"
Set-Content -Path "$base\App.jsx" -Value $content -Encoding UTF8
Write-Host "Done. Written to App.jsx"
