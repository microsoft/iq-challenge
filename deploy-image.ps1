<#
.SYNOPSIS
    Trivia Challenge - Docker Build & Deploy Script

.DESCRIPTION
    This script builds the Docker image, pushes it to Azure Container Registry,
    and ensures the Azure Web App pulls the latest image.

.PARAMETER AcrName
    Name of the Azure Container Registry (required)

.PARAMETER ResourceGroup
    Resource group name (default: rg-triviachallenge-bicep)

.PARAMETER AppName
    App Service name (if not provided, will be discovered)

.PARAMETER Slot
    App Service deployment slot (optional, deploys to production slot if not specified)

.PARAMETER ImageTag
    Additional image tag to apply (default: latest)

.PARAMETER NoCache
    Build without Docker cache

.PARAMETER StationLockdown
    Enable station lockdown build mode (default: disabled)

.EXAMPLE
    .\deploy-image.ps1 -AcrName myacrname

.EXAMPLE
    .\deploy-image.ps1 -AcrName myacrname -ResourceGroup my-resource-group -AppName my-webapp

.EXAMPLE
    .\deploy-image.ps1 -AcrName myacrname -Slot staging

.EXAMPLE
    .\deploy-image.ps1 -AcrName myacrname -ImageTag v1.2.3 -NoCache
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$AcrName,

    [Alias("g")]
    [string]$ResourceGroup = "rg-triviachallenge-bicep",

    [Alias("a")]
    [string]$AppName = "",

    [Alias("s")]
    [string]$Slot = "",

    [Alias("t")]
    [string]$ImageTag = "latest",

    [switch]$NoCache,

    [switch]$StationLockdown
)

Set-StrictMode -Version Latest
# NOTE: We intentionally do NOT set $ErrorActionPreference = "Stop" globally.
# PowerShell treats ANY stderr output from native commands (az, docker, git) as
# terminating errors under "Stop", even when the command succeeds (exit code 0).
# This is different from bash's "set -e" which only checks exit codes.
# Instead, we check $LASTEXITCODE explicitly after every critical native command.
$ErrorActionPreference = "Continue"

# Script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

##################################################
# Helper Functions
##################################################

function Write-LogInfo {
    param([string]$Message)
    Write-Host "i " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-LogSuccess {
    param([string]$Message)
    Write-Host "v " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-LogWarning {
    param([string]$Message)
    Write-Host "! " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-LogError {
    param([string]$Message)
    Write-Host "x " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

# Invoke a native command, suppressing stderr-as-error behavior.
# Returns stdout as a string. Sets $script:LastNativeExitCode for callers to check.
#
# NOTE: This is intentionally a simple function (no [CmdletBinding()]) so that
# PowerShell does NOT inject common parameters (-OutVariable, -OutBuffer, etc.).
# With CmdletBinding, az CLI flags like "-o tsv" become ambiguous against those
# common params. Without it, only our declared -SuppressStderr is checked, and
# all unmatched args (including az/docker/git flags) pass through via $args.
function Invoke-Native {
    param([switch]$SuppressStderr)

    # $args holds everything except -SuppressStderr: command + its arguments
    $Command = $args[0]
    $Arguments = @()
    if ($args.Count -gt 1) {
        $Arguments = $args[1..($args.Count - 1)]
    }

    if ($SuppressStderr) {
        $output = & $Command @Arguments 2>$null
    } else {
        # Merge stderr into stdout so it doesn't trigger PowerShell errors,
        # then separate out ErrorRecord objects (stderr lines)
        $raw = & $Command @Arguments 2>&1
        $stderr = $raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }
        $output = $raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }
        # Write stderr lines as warnings so they're visible but non-terminating
        foreach ($line in $stderr) {
            Write-Verbose $line.ToString()
        }
    }
    $script:LastNativeExitCode = $LASTEXITCODE
    return $output
}

function Test-Prerequisites {
    Write-LogInfo "Checking prerequisites..."

    # Check if Docker is installed
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-LogError "Docker is not installed. Please install Docker first."
        Write-Host ""
        Write-Host "Install Docker from: https://www.docker.com/products/docker-desktop"
        exit 1
    }

    # Check if Azure CLI is installed
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        Write-LogError "Azure CLI is not installed. Please install Azure CLI first."
        Write-Host ""
        Write-Host "Install Azure CLI:"
        Write-Host "  winget install Microsoft.AzureCLI"
        Write-Host "  Or: https://aka.ms/installazurecliwindows"
        exit 1
    }

    # Check if logged into Azure
    $null = Invoke-Native az account show -SuppressStderr
    if ($script:LastNativeExitCode -ne 0) {
        Write-LogError "Not logged into Azure. Please run 'az login' first."
        Write-Host ""
        Write-Host "To login to Azure:"
        Write-Host "  az login"
        Write-Host ""
        Write-Host "Or for service principal authentication:"
        Write-Host "  az login --service-principal -u <app-id> -p <password> --tenant <tenant-id>"
        exit 1
    }

    Write-LogSuccess "All prerequisites met"
}

function Test-AcrAccess {
    param([string]$AcrNameParam)

    Write-LogInfo "Verifying ACR access..."

    # Get ACR resource ID
    $acrId = Invoke-Native az acr show --name $AcrNameParam --resource-group $ResourceGroup --query id -o tsv -SuppressStderr
    if ($script:LastNativeExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($acrId)) {
        Write-LogError "Cannot access ACR '$AcrNameParam' in resource group '$ResourceGroup'"
        Write-Host ""
        Write-Host "Possible issues:"
        Write-Host "  1. ACR doesn't exist - verify the name"
        Write-Host "  2. Wrong resource group - check with: az acr list -o table"
        Write-Host "  3. Insufficient permissions - you need at least 'Reader' role"
        Write-Host ""
        Write-Host "To list all ACRs you have access to:"
        Write-Host '  az acr list --query "[].{Name:name, ResourceGroup:resourceGroup, Location:location}" -o table'
        exit 1
    }

    Write-LogSuccess "ACR found: $AcrNameParam"

    # Check current user/identity
    $currentUser = Invoke-Native az account show --query user.name -o tsv
    $userType = Invoke-Native az account show --query user.type -o tsv

    Write-LogInfo "Current identity: $currentUser (type: $userType)"

    # Check for push permissions via role assignments
    Write-LogInfo "Checking ACR push permissions..."

    $roleCheck = Invoke-Native az role assignment list --assignee $currentUser --scope $acrId --query "[?roleDefinitionName=='AcrPush' || roleDefinitionName=='Contributor' || roleDefinitionName=='Owner'].roleDefinitionName" -o tsv -SuppressStderr

    if (-not [string]::IsNullOrWhiteSpace($roleCheck)) {
        Write-LogSuccess "Found ACR push permissions: $roleCheck"
    }
    else {
        Write-LogWarning "No direct ACR role assignment found (this is OK if using group membership or subscription-level roles)"
    }

    # Try to login to ACR for Docker operations
    Write-LogInfo "Authenticating with ACR for Docker push..."

    $null = Invoke-Native az acr login --name $AcrNameParam -SuppressStderr
    if ($script:LastNativeExitCode -ne 0) {
        Write-LogError "Failed to authenticate with ACR '$AcrNameParam'"
        Write-Host ""
        Write-Host "This could mean:"
        Write-Host "  1. You don't have push permissions (need 'AcrPush' or 'Contributor' role)"
        Write-Host "  2. Docker daemon is not running"
        Write-Host "  3. Network connectivity issues"
        Write-Host ""
        Write-Host "To check your role assignments:"
        Write-Host "  az role assignment list --assignee $currentUser --scope $acrId"
        Write-Host ""
        Write-Host "To grant push permissions (requires admin):"
        Write-Host "  az role assignment create ``"
        Write-Host "    --assignee $currentUser ``"
        Write-Host "    --role AcrPush ``"
        Write-Host "    --scope $acrId"
        Write-Host ""
        Write-Host "Note: The Web App will use its managed identity to pull images."
        Write-Host "      You only need push permissions to upload the image."
        exit 1
    }

    Write-LogSuccess "ACR access verified"
}

function Test-WebAppManagedIdentity {
    param(
        [string]$WebAppName,
        [string]$SlotName
    )

    if ([string]::IsNullOrWhiteSpace($WebAppName)) {
        return
    }

    $slotArgs = @()
    if (-not [string]::IsNullOrWhiteSpace($SlotName)) {
        $slotArgs = @("--slot", $SlotName)
    }

    Write-LogInfo "Checking Web App managed identity configuration..."

    # Check if web app has managed identity enabled
    $miArgs = @("webapp", "identity", "show", "--name", $WebAppName, "--resource-group", $ResourceGroup) + $slotArgs + @("--query", "principalId", "-o", "tsv")
    $miEnabled = Invoke-Native az @miArgs -SuppressStderr

    if ([string]::IsNullOrWhiteSpace($miEnabled)) {
        Write-LogWarning "Web App does not have system-assigned managed identity enabled"
        Write-Host ""
        Write-Host "For production deployments, it's recommended to:"
        Write-Host "  1. Enable managed identity on the Web App"
        Write-Host "  2. Grant AcrPull role to the managed identity"
        Write-Host "  3. Configure Web App to use managed identity for ACR access"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  # Enable managed identity"
        Write-Host "  az webapp identity assign --name $WebAppName --resource-group $ResourceGroup"
        Write-Host ""
        Write-Host "  # Grant ACR pull permissions"
        Write-Host "  az role assignment create ``"
        Write-Host "    --assignee `$(az webapp identity show -n $WebAppName -g $ResourceGroup --query principalId -o tsv) ``"
        Write-Host "    --role AcrPull ``"
        Write-Host "    --scope `$(az acr show -n $AcrName -g $ResourceGroup --query id -o tsv)"
        Write-Host ""
        Write-Host "  # Configure Web App to use managed identity"
        Write-Host "  az webapp config set --name $WebAppName --resource-group $ResourceGroup ``"
        Write-Host '    --generic-configurations ''{"acrUseManagedIdentityCreds": true}'''
        Write-Host ""

        $continueChoice = Read-Host "Continue anyway? (y/n)"
        if ($continueChoice -ne "y") {
            Write-LogInfo "Deployment cancelled"
            exit 0
        }
    }
    else {
        Write-LogSuccess "Web App has managed identity enabled"

        # Check if ACR pull role is assigned
        $acrId = Invoke-Native az acr show --name $AcrName --resource-group $ResourceGroup --query id -o tsv
        $hasAcrPull = Invoke-Native az role assignment list --assignee $miEnabled --scope $acrId --query "[?roleDefinitionName=='AcrPull'].roleDefinitionName" -o tsv -SuppressStderr

        if (-not [string]::IsNullOrWhiteSpace($hasAcrPull)) {
            Write-LogSuccess "Managed identity has AcrPull permissions"
            Write-LogInfo "Web App will use managed identity to pull the image (no credentials needed)"
        }
        else {
            Write-LogWarning "Managed identity does not have AcrPull role on ACR"
            Write-Host ""
            Write-Host "To grant ACR pull permissions:"
            Write-Host "  az role assignment create ``"
            Write-Host "    --assignee $miEnabled ``"
            Write-Host "    --role AcrPull ``"
            Write-Host "    --scope $acrId"
            Write-Host ""
        }
    }
}

##################################################
# Main Script
##################################################

Write-Host ""
Write-LogInfo "========================================"
Write-LogInfo "Trivia Challenge - Docker Build & Deploy"
Write-LogInfo "========================================"
Write-Host ""

Test-Prerequisites

# Check ACR access and login
Test-AcrAccess -AcrNameParam $AcrName

# Get ACR login server
Write-LogInfo "Getting ACR login server..."
$AcrLoginServer = Invoke-Native az acr show --name $AcrName --resource-group $ResourceGroup --query loginServer --output tsv
if ($script:LastNativeExitCode -ne 0) {
    Write-LogError "Failed to get ACR login server"
    exit 1
}

Write-LogSuccess "ACR Login Server: $AcrLoginServer"

# Build image coordinates
$ImageRepo = "$AcrLoginServer/triviachallenge"

Write-LogInfo "Retrieving Git commit SHA..."
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-LogError "Git is required to determine the commit SHA for tagging"
    exit 1
}

$GitSha = Invoke-Native git -C $ScriptDir rev-parse --short=12 HEAD -SuppressStderr
if ($script:LastNativeExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($GitSha)) {
    Write-LogError "Unable to determine Git commit SHA. Ensure this script is run within a Git repository."
    exit 1
}

Write-LogSuccess "Git SHA: $GitSha"

$TagsToPush = @($GitSha)

if ($ImageTag -ne "latest" -and $ImageTag -ne $GitSha) {
    # Custom tag provided - push custom tag + git SHA only (no "latest")
    $TagsToPush += $ImageTag
}
else {
    # No custom tag - push latest + git SHA
    $TagsToPush += "latest"
}

Write-LogInfo "Image repository: $ImageRepo"
Write-LogInfo "Tags to apply: $($TagsToPush -join ', ')"

# Step 1: Build Docker Image
Write-LogInfo "========================================"
Write-LogInfo "Step 1: Building Docker image..."
Write-LogInfo "========================================"
Write-Host ""
Write-LogInfo "Image repository: $ImageRepo"
Write-LogInfo "Git SHA tag: $GitSha"
if ($ImageTag -ne "latest" -and $ImageTag -ne $GitSha) {
    Write-LogInfo "Additional tag: $ImageTag"
}
Write-LogInfo "All tags: $($TagsToPush -join ', ')"
Write-LogInfo "Context: $ScriptDir"

if ($NoCache) {
    Write-LogWarning "Building without cache..."
}

$StationLockdownValue = "false"
if ($StationLockdown) {
    $StationLockdownValue = "true"
}

Write-LogInfo "Station lockdown build flag: $StationLockdownValue"

Push-Location $ScriptDir

try {
    $buildCmd = @("build")

    if ($NoCache) {
        $buildCmd += "--no-cache"
    }

    foreach ($tag in $TagsToPush) {
        $buildCmd += "-t"
        $buildCmd += "${ImageRepo}:${tag}"
    }

    $buildCmd += "--build-arg"
    $buildCmd += "VITE_REQUIRE_STATION_ID=$StationLockdownValue"
    $buildCmd += "-f"
    $buildCmd += "Dockerfile"
    $buildCmd += "."

    $null = Invoke-Native docker @buildCmd
    if ($script:LastNativeExitCode -ne 0) {
        Write-LogError "Docker build failed"
        exit 1
    }

    Write-LogSuccess "Docker image built successfully"
    Write-Host ""

    # Step 2: Push Image to ACR
    Write-LogInfo "========================================"
    Write-LogInfo "Step 2: Pushing image to ACR..."
    Write-LogInfo "========================================"
    Write-Host ""

    Write-LogInfo "(Already logged in from prerequisite check)"

    foreach ($tag in $TagsToPush) {
        $localImage = "${ImageRepo}:${tag}"
        Write-LogInfo "Pushing image: $localImage"
        $null = Invoke-Native docker push $localImage
        if ($script:LastNativeExitCode -ne 0) {
            Write-LogError "Failed to push image tag '$tag' to ACR"
            Write-Host ""
            Write-Host "This could be due to:"
            Write-Host "  1. Network connectivity issues"
            Write-Host "  2. ACR storage quota exceeded"
            Write-Host "  3. ACR service temporarily unavailable"
            Write-Host ""
            Write-Host "Try logging in again manually:"
            Write-Host "  az acr login --name $AcrName"
            Write-Host ""
            Write-Host "Then retry the push:"
            Write-Host "  docker push $localImage"
            exit 1
        }
    }

    Write-LogSuccess "All image tags pushed successfully"
    Write-Host ""

    # Step 3: Restart Web App to Pull Latest Image
    Write-LogInfo "========================================"
    Write-LogInfo "Step 3: Updating Web App..."
    Write-LogInfo "========================================"
    Write-Host ""

    # Build slot arguments if a deployment slot was specified
    $slotArgs = @()
    if (-not [string]::IsNullOrWhiteSpace($Slot)) {
        $slotArgs = @("--slot", $Slot)
        Write-LogInfo "Deployment slot: $Slot"
    }

    # Discover App Service name if not provided
    if ([string]::IsNullOrWhiteSpace($AppName)) {
        Write-LogInfo "Discovering App Service name..."
        $AppName = Invoke-Native az webapp list --resource-group $ResourceGroup --query "[?tags.project=='trivia-challenge'].name | [0]" --output tsv -SuppressStderr

        if ([string]::IsNullOrWhiteSpace($AppName)) {
            Write-LogWarning "Could not automatically discover App Service name."
            Write-LogWarning "Please provide it with -AppName or restart manually with:"
            Write-Host ""
            Write-Host "  az webapp restart --name <app-name> --resource-group $ResourceGroup"
            Write-Host ""
            exit 0
        }

        Write-LogSuccess "Discovered App Service: $AppName"
    }

    # Check Web App managed identity configuration
    Test-WebAppManagedIdentity -WebAppName $AppName -SlotName $Slot

    # Update the container image configuration
    Write-LogInfo "Updating container image configuration..."
    $containerArgs = @("webapp", "config", "container", "set", "--name", $AppName, "--resource-group", $ResourceGroup) + $slotArgs + @("--docker-custom-image-name", "${ImageRepo}:${GitSha}", "--docker-registry-server-url", "https://$AcrLoginServer")
    $null = Invoke-Native az @containerArgs

    if ($script:LastNativeExitCode -ne 0) {
        Write-LogError "Failed to update container configuration"
        exit 1
    }

    Write-LogSuccess "Container configuration updated"

    # Restart the Web App to pull the latest image
    Write-LogInfo "Restarting Web App to pull latest image..."
    $restartArgs = @("webapp", "restart", "--name", $AppName, "--resource-group", $ResourceGroup) + $slotArgs
    $null = Invoke-Native az @restartArgs

    if ($script:LastNativeExitCode -ne 0) {
        Write-LogError "Failed to restart Web App"
        exit 1
    }

    Write-LogSuccess "Web App restarted successfully"
    Write-Host ""

    # Wait a moment for restart to initialize
    Write-LogInfo "Waiting for restart to initialize..."
    Start-Sleep -Seconds 5

    # Get the Web App URL
    $showArgs = @("webapp", "show", "--name", $AppName, "--resource-group", $ResourceGroup) + $slotArgs + @("--query", "defaultHostName", "--output", "tsv")
    $AppUrl = Invoke-Native az @showArgs

    Write-LogInfo "========================================"
    Write-LogSuccess "Deployment Complete!"
    Write-LogInfo "========================================"
    Write-Host ""
    Write-LogInfo "Image repository: $ImageRepo"
    Write-LogInfo "Tags pushed: $($TagsToPush -join ', ')"
    Write-LogInfo "Web App image: ${ImageRepo}:${GitSha}"
    Write-LogInfo "App Service: $AppName"
    if (-not [string]::IsNullOrWhiteSpace($Slot)) {
        Write-LogInfo "Deployment slot: $Slot"
    }
    Write-LogInfo "URL: https://$AppUrl"
    Write-Host ""
    Write-LogInfo "Monitor deployment status:"
    $slotDisplay = if ($slotArgs.Count -gt 0) { " $($slotArgs -join ' ')" } else { "" }
    Write-Host "  az webapp log tail --name $AppName --resource-group $ResourceGroup$slotDisplay"
    Write-Host ""
    Write-LogInfo "Check container logs:"
    Write-Host "  az webapp log tail --name $AppName --resource-group $ResourceGroup$slotDisplay"
    Write-Host ""
    Write-LogSuccess "Done!"
    Write-Host ""
}
finally {
    Pop-Location
}
