# Bulk onboarding from a real CSV file.
# First complete Prepare the domain: Corp, Users and Groups OUs.
# The supplied fictional intake is in Documents\new-hires.csv.
# Works with the IAM Range directory; use a lab DC with the AD module for real AD.
Import-Module ActiveDirectory
$csvPath = 'C:\Users\admin\Documents\new-hires.csv'
$users = Import-Csv -Path $csvPath
$temporaryPassword = ConvertTo-SecureString 'TempPass!2026##' -AsPlainText -Force

New-ADGroup -Name grp-hr-readers -GroupScope Global -Path "OU=Groups,OU=Corp,DC=omari,DC=test"
New-ADGroup -Name grp-iam-admins -GroupScope Global -Path "OU=Groups,OU=Corp,DC=omari,DC=test"
New-ADGroup -Name grp-finance-payroll -GroupScope Global -Path "OU=Groups,OU=Corp,DC=omari,DC=test"
New-ADGroup -Name grp-sales-readers -GroupScope Global -Path "OU=Groups,OU=Corp,DC=omari,DC=test"
New-ADGroup -Name grp-helpdesk-tier1 -GroupScope Global -Path "OU=Groups,OU=Corp,DC=omari,DC=test"

foreach ($user in $users) {
  New-ADUser -SamAccountName $user.SamAccountName -Name $user.Name -Department $user.Department -Title $user.Title -Path $user.Path -AccountPassword $temporaryPassword -ChangePasswordAtLogon $true -Enabled $true
  Add-ADGroupMember -Identity $user.Group -Members $user.SamAccountName
  Get-ADPrincipalGroupMembership -Identity $user.SamAccountName
}

Get-ADUser -Filter * -SearchBase "OU=Users,OU=Corp,DC=omari,DC=test" -Properties Department | Select-Object SamAccountName,Name,Department
Get-ADPrincipalGroupMembership -Identity ana.smith
