# Authenticated Scripts

Use a [service connection][serviceConnection] with scripts instead of pasting secrets into variables!

## Features

* ✅ Supply Generic Service Connection to a PowerShell script
* ✅ Supply Generic Service Connection to a Bash script

## How

![A screenshot showing the service connection exposed as environment variables](/docs/highlighted_env.png)

This task injects the values of a Generic Service Connection into the current environment so that the specified script may utilize them. The values of the Generic Service Connection are mapped to environment variables as follows:

| Service Connection Variable | Environment Variable |
| --------------------------- | -------------------- |
| url                         | AS_SC_URL            |
| username                    | AS_SC_USERNAME       |
| password                    | AS_SC_PASSWORD       |

Please note that this task does **not** persist the environment variables for longer than the execution of the script itself.

### A note on acronyms

`AS_SC_` (i.e. *Authenticated Shell Service Connection*) is prepended to the environment variable names to reduce the chance of collisions.

## Example

Please note that `serviceConnection: 'Testing Authenticated Shell'` was configured with a [Service Connection][serviceConnection]. 

```yml
steps:
- task: AuthenticatedPowerShell@1  
  inputs:
    serviceConnection: 'Testing Authenticated Shell'
    targetType: inline
    script: 'Write-Host "url: $env:AS_SC_URL | username: $env:AS_SC_USERNAME | password: $env:AS_SC_PASSWORD"'
- task: AuthenticatedBash@1  
  inputs:
    serviceConnection: 'Testing Authenticated Shell'
    script: 'echo "Hello $AS_SC_URL $AS_SC_USERNAME $AS_SC_PASSWORD"'     
```

## Motivation

Long story short, no other extension allowed one to use Generic Service Connections with a custom script.

---

There are many tasks today that ship with Service Connections so that users of Azure DevOps can connect to secured resources in a consistent and auditable fashion. With enough usage of Azure DevOps, one is sure to come across a scenario that does not yet have a corresponding task. There are two options to proceed with at this point:

1. Write a custom task/extension.
2. Write a script until a task/extension can be made.

As creating (and *maintaining*) a custom task is a non-trivial effort, many folks opt for writing and executing a script (e.g. Bash or PowerShell). Unfortunately, as of the initial writing of this, no other tasks existed that allowed a script to access Service Connections in a consistent and secure fashion. Thus this extension was created- so that scripts can utilize Service Connections in a consistent fashion.

So why not simply use private variables (as some answers to "How to use a Service Connection in a Script" suggest)? This could boil down to preference, but Service Connections offer a variety of benefits over using variables (e.g. update onc and use across many pipelines, approvals and checks, etc).

Instances of folks asking for this:

* https://github.com/microsoft/azure-pipelines-tasks/issues/11645
* https://stackoverflow.com/q/57234110/1542187

## EULA

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

[serviceConnection]: https://docs.microsoft.com/en-us/azure/devops/pipelines/library/service-endpoints?view=azure-devops&tabs=yaml