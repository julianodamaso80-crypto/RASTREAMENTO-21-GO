@echo off
echo Criando regras de firewall para Traccar...
netsh advfirewall firewall add rule name="Traccar OsmAnd TCP 5055" dir=in action=allow protocol=TCP localport=5055 profile=private,domain
netsh advfirewall firewall add rule name="Traccar OsmAnd UDP 5055" dir=in action=allow protocol=UDP localport=5055 profile=private,domain
netsh advfirewall firewall add rule name="Traccar Web 8082" dir=in action=allow protocol=TCP localport=8082 profile=private,domain
echo.
echo Regras criadas! Verificando...
netsh advfirewall firewall show rule name="Traccar OsmAnd TCP 5055"
echo.
pause
